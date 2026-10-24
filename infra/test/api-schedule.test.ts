import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { remove, save } from '../lambda/api/handlers/content.ts';
import { EndScheduler, FIRE_AFTER_END_MS, MIN_LEAD_MS, atExpression, scheduleName, wantedSchedule, type SchedulerLike } from '../lambda/api/lib/schedule.ts';
import { HttpError } from '../lambda/api/lib/http.ts';
import { eventDoc, makeDeps, makeEvent, speakerDoc } from './helpers/fake-aws.ts';
import { FakeScheduler } from './helpers/fake-scheduler.ts';

const NOW = Date.parse('2026-10-22T10:00:00Z');

const config = (client: SchedulerLike) => ({ client, groupName: 'awsug-events', roleArn: 'arn:aws:iam::1:role/sched', buildProject: 'awsug-site', now: () => NOW });

describe('scheduleName', () => {
  it('is readable for normal slugs', () => assert.equal(scheduleName('meetup-13-gurugram'), 'awsug-end-meetup-13-gurugram'));

  it('stays within Scheduler\'s 64-character limit and allowed characters, even for the longest slug (80)', () => {
    const name = scheduleName('a'.repeat(80));
    assert.ok(name.length <= 64, `${name.length}`);
    assert.match(name, /^[0-9a-zA-Z._-]+$/);
  });

  it('is deterministic, and distinguishes long slugs that share a long prefix', () => {
    const prefix = 'community-day-delhi-ncr-with-a-very-long-descriptive-title-';
    const a = scheduleName(`${prefix}2027`);
    const b = scheduleName(`${prefix}2028`);
    assert.equal(a, scheduleName(`${prefix}2027`));
    assert.notEqual(a, b);
    assert.ok(a.length <= 64 && b.length <= 64);
  });
});

describe('atExpression', () => {
  it('writes the moment as Indian time, whatever zone the machine is in', () => {
    // 14:01 UTC is 19:31 IST.
    assert.equal(atExpression(Date.parse('2026-11-14T14:01:00Z')), 'at(2026-11-14T19:31:00)');
    // crossing midnight in IST: 19:00 UTC is 00:30 IST the next day.
    assert.equal(atExpression(Date.parse('2026-12-31T19:00:00Z')), 'at(2027-01-01T00:30:00)');
  });
});

describe('wantedSchedule', () => {
  const end = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

  it('has nothing to say about anything but events', () => {
    assert.equal(wantedSchedule('speakers', speakerDoc, NOW), null);
    assert.equal(wantedSchedule('posts', {}, NOW), null);
  });
  it('wants a job one minute after a future event ends', () => {
    const w = wantedSchedule('events', { end: end(3_600_000) }, NOW);
    assert.deepEqual(w, { kind: 'upsert', fireAt: NOW + 3_600_000 + FIRE_AFTER_END_MS });
  });
  it('wants no job for a draft, which is not on the site anyway', () => {
    assert.deepEqual(wantedSchedule('events', { end: end(3_600_000), draft: true }, NOW), { kind: 'remove', reason: 'draft' });
  });
  it('wants no job for an event that is over, or about to be (Scheduler rejects times in the past)', () => {
    assert.deepEqual(wantedSchedule('events', { end: end(-3_600_000) }, NOW), { kind: 'remove', reason: 'already-over' });
    assert.equal(wantedSchedule('events', { end: end(-FIRE_AFTER_END_MS + MIN_LEAD_MS - 1000) }, NOW)?.kind, 'remove');
    assert.equal(wantedSchedule('events', { end: 'garbage' }, NOW)?.kind, 'remove');
  });
});

describe('EndScheduler', () => {
  let client: FakeScheduler;
  let scheduler: EndScheduler;
  beforeEach(() => {
    client = new FakeScheduler();
    scheduler = new EndScheduler(config(client));
  });
  const future = (h = 5) => ({ end: new Date(NOW + h * 3_600_000).toISOString() });

  it('creates a one-time job in IST that starts the build, deletes itself afterwards and retries for an hour', async () => {
    const r = await scheduler.sync('events', 'meetup-13', future(5));
    assert.equal(r.action, 'scheduled');
    const { type, input } = client.calls[0]!;
    assert.equal(type, 'CreateSchedule');
    assert.equal(input.Name, 'awsug-end-meetup-13');
    assert.equal(input.GroupName, 'awsug-events');
    assert.equal(input.ScheduleExpression, atExpression(NOW + 5 * 3_600_000 + FIRE_AFTER_END_MS));
    assert.equal(input.ScheduleExpressionTimezone, 'Asia/Kolkata');
    assert.equal(input.ActionAfterCompletion, 'DELETE');
    assert.deepEqual(input.FlexibleTimeWindow, { Mode: 'OFF' });
    assert.equal(input.State, 'ENABLED');
    assert.equal(input.Target.Arn, 'arn:aws:scheduler:::aws-sdk:codebuild:startBuild');
    assert.equal(input.Target.RoleArn, 'arn:aws:iam::1:role/sched');
    assert.deepEqual(JSON.parse(input.Target.Input), { ProjectName: 'awsug-site' });
    assert.deepEqual(input.Target.RetryPolicy, { MaximumRetryAttempts: 5, MaximumEventAgeInSeconds: 3600 });
  });

  it('moves the existing job when the event is rescheduled, instead of failing or duplicating', async () => {
    await scheduler.sync('events', 'meetup-13', future(5));
    await scheduler.sync('events', 'meetup-13', future(8));
    assert.deepEqual(client.calls.map((c) => c.type), ['CreateSchedule', 'CreateSchedule', 'UpdateSchedule']);
    assert.equal(client.calls[2]!.input.ScheduleExpression, atExpression(NOW + 8 * 3_600_000 + FIRE_AFTER_END_MS));
    assert.equal(client.existing.size, 1);
  });

  it('removes the job when the event becomes a draft or ends up in the past, and tolerates there being none', async () => {
    await scheduler.sync('events', 'meetup-13', future(5));
    assert.equal((await scheduler.sync('events', 'meetup-13', { ...future(5), draft: true })).action, 'removed');
    assert.equal(client.existing.size, 0);
    assert.equal((await scheduler.sync('events', 'meetup-13', { end: new Date(NOW - 3_600_000).toISOString() })).action, 'removed'); // nothing to delete: not an error
  });

  it('does nothing for non-events', async () => {
    assert.equal((await scheduler.sync('speakers', 'asha', speakerDoc)).action, 'skipped');
    assert.equal(client.calls.length, 0);
  });

  it('lets real failures surface, so the caller can warn', async () => {
    client.failWith = Object.assign(new Error('boom'), { name: 'AccessDeniedException' });
    await assert.rejects(scheduler.sync('events', 'meetup-13', future(5)), /boom/);
  });
});

describe('save and delete drive the schedule', () => {
  const org = { username: 'asha', sub: 's1' };
  const farEnd = '2037-03-01T20:30:00+05:30';
  let client: FakeScheduler;
  let ctx: ReturnType<typeof makeDeps>['deps'];

  beforeEach(() => {
    client = new FakeScheduler();
    ctx = makeDeps().deps;
    // A scheduler whose clock is "now" for the whole 2020s test data.
    ctx.scheduler = new EndScheduler({ ...config(client), now: () => Date.parse('2037-01-01T00:00:00Z') });
  });

  const quiet = async <T>(fn: () => Promise<T>) => {
    const log = console.log;
    console.log = () => {};
    try {
      return await fn();
    } finally {
      console.log = log;
    }
  };
  const create = (id: string, doc: unknown) => quiet(() => save(makeEvent({ params: { collection: 'events', id }, headers: { 'if-none-match': '*' }, body: doc }), { organizer: org, deps: ctx }));
  const body = (r: { body?: string }) => JSON.parse(r.body ?? '{}');

  it('schedules the switch to Past when an event is created', async () => {
    const r = await create('talk', eventDoc({ end: farEnd, start: '2037-03-01T19:00:00+05:30' }));
    assert.equal(r.statusCode, 201);
    assert.equal(body(r).warnings, undefined);
    assert.equal(client.calls.length, 1);
    assert.equal(client.calls[0]!.input.Name, 'awsug-end-talk');
    assert.equal(client.calls[0]!.input.ScheduleExpression, 'at(2037-03-01T20:31:00)'); // end 20:30 IST + 1 minute
  });

  it('does not schedule for a draft, and removes the job when an event is turned into a draft', async () => {
    await create('talk', eventDoc({ end: farEnd, start: '2037-03-01T19:00:00+05:30' }));
    const stored = await ctx.store.get('events', 'talk');
    const r = await quiet(() => save(makeEvent({ params: { collection: 'events', id: 'talk' }, headers: { 'if-match': stored!.etag }, body: eventDoc({ end: farEnd, start: '2037-03-01T19:00:00+05:30', draft: true }) }), { organizer: org, deps: ctx }));
    assert.equal(r.statusCode, 200);
    assert.deepEqual(client.calls.map((c) => c.type), ['CreateSchedule', 'DeleteSchedule']);
  });

  it('removes the job when the event is deleted', async () => {
    await create('talk', eventDoc({ end: farEnd, start: '2037-03-01T19:00:00+05:30' }));
    const r = await quiet(() => remove(makeEvent({ params: { collection: 'events', id: 'talk' } }), { organizer: org, deps: ctx }));
    assert.equal(r.statusCode, 200);
    assert.equal(client.calls.at(-1)!.type, 'DeleteSchedule');
    assert.equal(client.existing.size, 0);
  });

  it('never touches the scheduler for other kinds of content', async () => {
    await quiet(() => save(makeEvent({ params: { collection: 'speakers', id: 'ravi' }, headers: { 'if-none-match': '*' }, body: speakerDoc }), { organizer: org, deps: ctx }));
    assert.equal(client.calls.length, 0);
  });

  it('still saves the content, and says so, when scheduling fails', async () => {
    client.failWith = Object.assign(new Error('throttled'), { name: 'ThrottlingException' });
    const errors: string[] = [];
    const orig = console.error;
    console.error = (m: string) => errors.push(m);
    try {
      const r = await create('talk', eventDoc({ end: farEnd, start: '2037-03-01T19:00:00+05:30' }));
      assert.equal(r.statusCode, 201);
      assert.equal(body(r).warnings[0].code, 'schedule_failed');
      assert.match(body(r).warnings[0].message, /nightly rebuild/);
      assert.match(errors[0] ?? '', /throttled/, 'the detail is logged, not shown');
    } finally {
      console.error = orig;
    }
    assert.ok(await ctx.store.get('events', 'talk'), 'the event itself was saved');
  });

  it('works without a scheduler configured (before the Build stack exists)', async () => {
    ctx.scheduler = undefined;
    const r = await create('talk', eventDoc({ end: farEnd, start: '2037-03-01T19:00:00+05:30' }));
    assert.equal(r.statusCode, 201);
    assert.equal(body(r).warnings, undefined);
  });

  it('does not let a scheduling problem mask validation errors', async () => {
    client.failWith = new Error('should not be reached');
    await assert.rejects(create('bad', eventDoc({ summary: 'x'.repeat(200) })), (e: unknown) => e instanceof HttpError && e.status === 422);
    assert.equal(client.calls.length, 0);
  });
});
