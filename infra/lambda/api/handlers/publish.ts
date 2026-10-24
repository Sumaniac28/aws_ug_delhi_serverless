// POST /publish starts a site build; GET /publish reports the latest one and what is still waiting to go live.
// The build project is created by the Build stack; without it both routes answer 503.
import { BatchGetBuildsCommand, ListBuildsForProjectCommand, StartBuildCommand, type Build } from '@aws-sdk/client-codebuild';
import { HttpError, json, type ApiEvent, type ApiResult } from '../lib/http.ts';
import type { Ctx, Deps } from '../lib/route.ts';
import { mapLimit, type Change } from '../lib/store.ts';

const summarize = (b: Build) => ({ buildId: b.id, buildStatus: b.buildStatus, phase: b.currentPhase, startedAt: b.startTime, endedAt: b.endTime });

/** Enough history to find the last good build even after a few failed or stopped ones. */
const HISTORY = 25;
/** The publish screen lists this many waiting changes; the count always covers all of them. */
const LISTED = 25;

function project(deps: Deps): string {
  if (!deps.buildProject) throw new HttpError(503, 'publishing_not_configured', 'Publishing is not set up yet. The build project arrives with Phase 6.');
  return deps.buildProject;
}

/** Newest first, whatever started them (the Publish button, the nightly job or an event ending). */
async function recentBuilds(deps: Deps, name: string): Promise<Build[]> {
  const listed = await deps.codebuild.send(new ListBuildsForProjectCommand({ projectName: name, sortOrder: 'DESCENDING' }));
  const ids = (listed.ids ?? []).slice(0, HISTORY);
  if (!ids.length) return [];
  const res = await deps.codebuild.send(new BatchGetBuildsCommand({ ids }));
  // BatchGetBuilds does not promise to answer in the order asked.
  const byId = new Map((res.builds ?? []).map((b) => [b.id, b]));
  return ids.map((id) => byId.get(id)).filter((b): b is Build => !!b);
}

interface PendingItem {
  collection: Change['collection'];
  id: string;
  kind: Change['kind'];
  at: Date;
  /** What the organizer would recognise: the event title or the person's name. */
  label?: string;
  editor?: string;
}

async function describe(deps: Deps, change: Change): Promise<PendingItem> {
  if (change.kind === 'deleted') return { ...change };
  const stored = await deps.store.get(change.collection, change.id);
  const data = (stored?.data ?? {}) as { title?: unknown; name?: unknown };
  const label = typeof data.title === 'string' ? data.title : typeof data.name === 'string' ? data.name : undefined;
  return { ...change, label, editor: stored?.editor };
}

/**
 * What the Publish button needs to know. "Waiting" means saved or deleted after the last build that SUCCEEDED
 * started: the build copies the content at its start, so anything older is already on the site.
 */
async function snapshot(deps: Deps, name: string) {
  const builds = await recentBuilds(deps, name);
  const latest = builds[0];
  const lastSuccess = builds.find((b) => b.buildStatus === 'SUCCEEDED');
  const changes = await deps.store.changesSince(lastSuccess?.startTime);
  const items = await mapLimit(changes.slice(0, LISTED), 8, (c) => describe(deps, c));
  return { builds, latest, lastSuccess, pending: { count: changes.length, items } };
}

export async function publishStatus(_event: ApiEvent, { deps }: Ctx): Promise<ApiResult> {
  const { latest, lastSuccess, pending } = await snapshot(deps, project(deps));
  return json(200, { latest: latest ? summarize(latest) : null, lastSuccess: lastSuccess ? summarize(lastSuccess) : null, pending });
}

export async function publish(_event: ApiEvent, { organizer, deps }: Ctx): Promise<ApiResult> {
  const name = project(deps);
  const { builds, latest, pending } = await snapshot(deps, name);

  // One build at a time: a second click while one runs just reports the one already running.
  const running = builds.find((b) => b.buildStatus === 'IN_PROGRESS');
  if (running) return json(202, { status: 'already-running', ...summarize(running) });

  // Every build costs money and minutes, so refuse one that cannot change the site. After a failed or stopped
  // build the answer is always yes: whatever it was meant to publish is still waiting.
  if (latest?.buildStatus === 'SUCCEEDED' && pending.count === 0) {
    throw new HttpError(409, 'nothing_to_publish', 'Everything you saved is already live. Save a change first, then put it live.');
  }

  const started = await deps.codebuild.send(new StartBuildCommand({ projectName: name }));
  console.log(JSON.stringify({ msg: 'publish started', editor: organizer.username, buildId: started.build?.id, waiting: pending.count }));
  return json(202, { status: 'started', ...(started.build ? summarize(started.build) : {}) });
}
