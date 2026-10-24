import { randomBytes } from 'node:crypto';
import { CodeBuildClient } from '@aws-sdk/client-codebuild';
import { S3Client } from '@aws-sdk/client-s3';
import { SchedulerClient } from '@aws-sdk/client-scheduler';
import { requireOrganizer, type Organizer } from './auth.ts';
import { HttpError, json, type ApiEvent, type ApiResult } from './http.ts';
import { EndScheduler } from './schedule.ts';
import { ContentStore } from './store.ts';

export interface Deps {
  store: ContentStore;
  /** Used to presign uploads; signs with the function's own role credentials. */
  s3: S3Client;
  mediaBucket: string;
  codebuild: Pick<CodeBuildClient, 'send'>;
  /** Unset until the Build stack exists (Phase 6); publishing answers 503 meanwhile. */
  buildProject?: string;
  randomId: () => string;
  /** Moves events to Past on time. Absent until the Build stack exists; saving then simply does not schedule. */
  scheduler?: EndScheduler;
}

export interface Ctx {
  organizer: Organizer;
  deps: Deps;
}

export type Handler = (event: ApiEvent, ctx: Ctx) => Promise<ApiResult>;

let cached: Deps | undefined;
export function getDeps(): Deps {
  if (!cached) {
    const contentBucket = process.env.CONTENT_BUCKET;
    const mediaBucket = process.env.MEDIA_BUCKET;
    if (!contentBucket || !mediaBucket) throw new Error('CONTENT_BUCKET and MEDIA_BUCKET must be set');
    const s3 = new S3Client({});
    cached = {
      store: new ContentStore(s3, contentBucket),
      s3,
      mediaBucket,
      codebuild: new CodeBuildClient({}),
      buildProject: process.env.BUILD_PROJECT || undefined,
      randomId: () => randomBytes(4).toString('hex'),
      scheduler:
        process.env.SCHEDULE_GROUP && process.env.SCHEDULER_ROLE_ARN && process.env.BUILD_PROJECT
          ? new EndScheduler({ client: new SchedulerClient({}), groupName: process.env.SCHEDULE_GROUP, roleArn: process.env.SCHEDULER_ROLE_ARN, buildProject: process.env.BUILD_PROJECT })
          : undefined,
    };
  }
  return cached;
}

/**
 * Wraps a handler: authenticates the caller as an organizer, then turns HttpErrors into JSON error
 * responses. Anything unexpected becomes a generic 500 so internals never leak to the browser.
 */
export function route(handler: Handler, deps: () => Deps = getDeps) {
  return async (event: ApiEvent): Promise<ApiResult> => {
    try {
      const organizer = requireOrganizer(event);
      return await handler(event, { organizer, deps: deps() });
    } catch (e) {
      if (e instanceof HttpError) {
        return json(e.status, { error: { code: e.code, message: e.message, ...(e.details === undefined ? {} : { details: e.details }) } });
      }
      console.error(JSON.stringify({ msg: 'unhandled error', route: event.routeKey, error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : String(e) }));
      return json(500, { error: { code: 'internal', message: 'Something went wrong. Try again, and tell the tech volunteer if it keeps happening.' } });
    }
  };
}
