// POST /publish starts a site build; GET /publish reports the latest one.
// The CodeBuild project itself is created in Phase 6. Until then BUILD_PROJECT is unset and both answer 503.
import { BatchGetBuildsCommand, ListBuildsForProjectCommand, StartBuildCommand, type Build } from '@aws-sdk/client-codebuild';
import { HttpError, json, type ApiEvent, type ApiResult } from '../lib/http.ts';
import type { Ctx, Deps } from '../lib/route.ts';

const summarize = (b: Build) => ({ buildId: b.id, buildStatus: b.buildStatus, phase: b.currentPhase, startedAt: b.startTime, endedAt: b.endTime });

function project(deps: Deps): string {
  if (!deps.buildProject) throw new HttpError(503, 'publishing_not_configured', 'Publishing is not set up yet. The build project arrives with Phase 6.');
  return deps.buildProject;
}

async function recentBuilds(deps: Deps, name: string): Promise<Build[]> {
  const listed = await deps.codebuild.send(new ListBuildsForProjectCommand({ projectName: name, sortOrder: 'DESCENDING' }));
  const ids = (listed.ids ?? []).slice(0, 5);
  if (!ids.length) return [];
  const res = await deps.codebuild.send(new BatchGetBuildsCommand({ ids }));
  return res.builds ?? [];
}

export async function publishStatus(_event: ApiEvent, { deps }: Ctx): Promise<ApiResult> {
  const [latest] = await recentBuilds(deps, project(deps));
  return json(200, { latest: latest ? summarize(latest) : null });
}

export async function publish(_event: ApiEvent, { organizer, deps }: Ctx): Promise<ApiResult> {
  const name = project(deps);

  // One build at a time: a second click while one runs just reports the one already running.
  const running = (await recentBuilds(deps, name)).find((b) => b.buildStatus === 'IN_PROGRESS');
  if (running) return json(202, { status: 'already-running', ...summarize(running) });

  const started = await deps.codebuild.send(new StartBuildCommand({ projectName: name }));
  console.log(JSON.stringify({ msg: 'publish started', editor: organizer.username, buildId: started.build?.id }));
  return json(202, { status: 'started', ...(started.build ? summarize(started.build) : {}) });
}
