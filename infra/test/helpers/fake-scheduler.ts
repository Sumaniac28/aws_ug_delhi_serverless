import type { SchedulerLike } from '../../lambda/api/lib/schedule.ts';

/**
 * In-memory EventBridge Scheduler: records every call and behaves like the real one for the cases that matter
 * (creating over an existing job conflicts, updating or deleting a missing job is "not found").
 * Used by the unit tests and by the local mock API, so both run the real scheduling code.
 */
export class FakeScheduler implements SchedulerLike {
  /** Names of the jobs that currently exist, with the expression each fires at. */
  readonly existing = new Map<string, string>();
  readonly calls: { type: string; input: any }[] = [];
  /** Set to make every call fail, to test how callers cope. */
  failWith?: Error;

  async send(cmd: any): Promise<any> {
    const type = cmd.constructor.name.replace(/Command$/, '');
    this.calls.push({ type, input: cmd.input });
    if (this.failWith) throw this.failWith;
    const name = cmd.input.Name as string;
    const err = (n: string) => Object.assign(new Error(n), { name: n });
    if (type === 'CreateSchedule') {
      if (this.existing.has(name)) throw err('ConflictException');
      this.existing.set(name, cmd.input.ScheduleExpression);
    } else if (type === 'UpdateSchedule') {
      if (!this.existing.has(name)) throw err('ResourceNotFoundException');
      this.existing.set(name, cmd.input.ScheduleExpression);
    } else if (type === 'DeleteSchedule') {
      if (!this.existing.delete(name)) throw err('ResourceNotFoundException');
    }
    return {};
  }
}
