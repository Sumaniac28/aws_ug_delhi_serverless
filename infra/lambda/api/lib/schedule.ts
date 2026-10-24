/**
 * Moves events from Upcoming to Past on time (ADR-002 decision 8, layer 1).
 *
 * Whenever an event is saved, a one-time EventBridge Scheduler job is created (or moved) to just after the
 * event's end, in Indian time. It starts a site build, and the build, running after the end time, renders the
 * event under Past. Deleting the event, turning it into a draft, or moving its end into the past removes the job.
 * The nightly rebuild and a small script in the page are the fallbacks (layers 2 and 3).
 */
import { CreateScheduleCommand, DeleteScheduleCommand, UpdateScheduleCommand, type SchedulerClient } from '@aws-sdk/client-scheduler';
import { createHash } from 'node:crypto';
import type { CollectionName } from './collections.ts';

export type SchedulerLike = Pick<SchedulerClient, 'send'>;

/** The build starts a minute after the end, so "ended" is already true when the site is rendered. */
export const FIRE_AFTER_END_MS = 60_000;
/** A job that would fire in less than this is not worth creating (and Scheduler rejects times in the past). */
export const MIN_LEAD_MS = 30_000;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const NAME_LIMIT = 64; // Scheduler schedule names: up to 64 of [0-9a-zA-Z-_.]

/** Deterministic job name for an event. Slugs may be up to 80 characters, so long ones are shortened plus hashed. */
export function scheduleName(slug: string): string {
  const full = `awsug-end-${slug}`;
  if (full.length <= NAME_LIMIT) return full;
  return `awsug-end-${slug.slice(0, 40)}-${createHash('sha1').update(slug).digest('hex').slice(0, 8)}`;
}

/** at(...) expression, written as Indian time to match ScheduleExpressionTimezone: Asia/Kolkata. */
export function atExpression(fireAtMs: number): string {
  return `at(${new Date(fireAtMs + IST_OFFSET_MS).toISOString().slice(0, 19)})`;
}

export type Wanted = { kind: 'upsert'; fireAt: number } | { kind: 'remove'; reason: 'draft' | 'already-over' };

/** What the schedule for this document should be. null: this kind of document has no schedule at all. */
export function wantedSchedule(collection: CollectionName, doc: Record<string, any>, now: number): Wanted | null {
  if (collection !== 'events') return null;
  if (doc.draft === true) return { kind: 'remove', reason: 'draft' }; // not published, so nothing to flip
  const end = Date.parse(String(doc.end));
  if (Number.isNaN(end)) return { kind: 'remove', reason: 'already-over' };
  const fireAt = end + FIRE_AFTER_END_MS;
  return fireAt - now < MIN_LEAD_MS ? { kind: 'remove', reason: 'already-over' } : { kind: 'upsert', fireAt };
}

export interface SchedulerConfig {
  client: SchedulerLike;
  /** Schedule group that holds all per-event jobs. */
  groupName: string;
  /** Role Scheduler assumes to start the build. */
  roleArn: string;
  /** CodeBuild project to start. */
  buildProject: string;
  now?: () => number;
}

export type SyncResult = { action: 'scheduled'; name: string; at: string } | { action: 'removed' | 'skipped'; name?: string };

const errName = (e: unknown) => (e as { name?: string })?.name;

export class EndScheduler {
  private readonly now: () => number;
  constructor(private readonly cfg: SchedulerConfig) {
    this.now = cfg.now ?? Date.now;
  }

  /** Brings the job in line with the document. Safe to call on every save. */
  async sync(collection: CollectionName, slug: string, doc: Record<string, any>): Promise<SyncResult> {
    const wanted = wantedSchedule(collection, doc, this.now());
    if (!wanted) return { action: 'skipped' };
    if (wanted.kind === 'remove') {
      await this.remove(slug);
      return { action: 'removed', name: scheduleName(slug) };
    }

    const name = scheduleName(slug);
    const at = atExpression(wanted.fireAt);
    const input = {
      Name: name,
      GroupName: this.cfg.groupName,
      Description: `Rebuild the site when "${slug}" ends so it moves from Upcoming to Past`,
      ScheduleExpression: at,
      ScheduleExpressionTimezone: 'Asia/Kolkata',
      FlexibleTimeWindow: { Mode: 'OFF' as const },
      ActionAfterCompletion: 'DELETE' as const, // one-time job: gone once it has run
      State: 'ENABLED' as const,
      Target: {
        Arn: 'arn:aws:scheduler:::aws-sdk:codebuild:startBuild', // Scheduler's built-in CodeBuild StartBuild call
        RoleArn: this.cfg.roleArn,
        Input: JSON.stringify({ ProjectName: this.cfg.buildProject }),
        // If a build is already running at that moment the start may be refused; keep trying for an hour.
        RetryPolicy: { MaximumRetryAttempts: 5, MaximumEventAgeInSeconds: 3600 },
      },
    };
    try {
      await this.cfg.client.send(new CreateScheduleCommand(input));
    } catch (e) {
      if (errName(e) !== 'ConflictException') throw e;
      await this.cfg.client.send(new UpdateScheduleCommand(input)); // already exists: move it
    }
    return { action: 'scheduled', name, at };
  }

  /** Deletes the job if there is one. */
  async remove(slug: string): Promise<void> {
    try {
      await this.cfg.client.send(new DeleteScheduleCommand({ Name: scheduleName(slug), GroupName: this.cfg.groupName }));
    } catch (e) {
      if (errName(e) !== 'ResourceNotFoundException') throw e;
    }
  }
}
