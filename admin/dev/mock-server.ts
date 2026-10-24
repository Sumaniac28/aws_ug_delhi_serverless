/**
 * Local stand-in for the deployed admin API, for development and tests. It runs the REAL Phase 4 Lambda
 * handlers (infra/lambda/api) over an in-memory, versioned S3, so validation, conflict detection and
 * reference checks behave exactly as in AWS. Only the plumbing is fake: auth is a fixed organizer, photo
 * uploads land in memory (and "process" after a moment), and publishing is a timer.
 *
 *   npm run dev:mock     ->  http://localhost:8787   (then `npm run dev` for the admin UI)
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { list, get, save, remove } from '../../infra/lambda/api/handlers/content.ts';
import { publish, publishStatus } from '../../infra/lambda/api/handlers/publish.ts';
import { sign } from '../../infra/lambda/api/handlers/uploads.ts';
import type { ApiEvent, ApiResult } from '../../infra/lambda/api/lib/http.ts';
import { route, type Handler } from '../../infra/lambda/api/lib/route.ts';
import { EndScheduler } from '../../infra/lambda/api/lib/schedule.ts';
import { FakeS3, makeDeps } from '../../infra/test/helpers/fake-aws.ts';
import { FakeScheduler } from '../../infra/test/helpers/fake-scheduler.ts';

// The repo root. Under Vitest import.meta.url is not a file: URL, so fall back to the working directory (admin/).
const ROOT = (() => {
  try {
    return resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  } catch {
    return resolve(process.cwd(), '..');
  }
})();
// Fictional sample records, so local admin work and tests never touch (or depend on) the real migrated content.
const CONTENT_DIR = join(ROOT, 'fixtures/sample-content');
const SAMPLE_MEDIA_DIR = join(ROOT, 'public/media');

export interface MockOptions {
  port?: number;
  /** Load the fictional sample content (fixtures/sample-content) into the fake bucket. */
  seed?: boolean;
  /** How long a "build" runs, in ms. */
  buildMs?: number;
  /** How long a photo takes to "process", in ms. */
  processMs?: number;
  /** Silence request logging (tests). */
  quiet?: boolean;
  /** Make every scheduling call fail, to see how the app reports it. */
  failScheduling?: boolean;
}

interface Upload {
  bytes: Buffer;
  type: string;
  readyAt: number;
}

export async function startMockServer(opts: MockOptions = {}) {
  const { port = 8787, seed = true, buildMs = 6000, processMs = 1500, quiet = false, failScheduling = false } = opts;
  const s3 = new FakeS3(50);
  if (seed) seedContent(s3);

  const uploads = new Map<string, Upload>(); // mediaKey -> file
  const builds: { id: string; startedAt: number }[] = [];
  const buildStatus = (b: { startedAt: number }) => (Date.now() - b.startedAt < buildMs ? 'IN_PROGRESS' : 'SUCCEEDED');
  const asBuild = (b: { id: string; startedAt: number }) => ({ id: b.id, buildStatus: buildStatus(b), currentPhase: buildStatus(b) === 'IN_PROGRESS' ? 'BUILD' : 'COMPLETED', startTime: new Date(b.startedAt), endTime: buildStatus(b) === 'SUCCEEDED' ? new Date(b.startedAt + buildMs) : undefined });

  const codebuild = {
    send: async (cmd: any) => {
      // Matched by class name: the SDK lives in infra/, not here.
      const name = cmd.constructor.name;
      if (name === 'ListBuildsForProjectCommand') return { ids: builds.map((b) => b.id).reverse() };
      if (name === 'BatchGetBuildsCommand') return { builds: builds.filter((b) => (cmd.input.ids ?? []).includes(b.id)).map(asBuild) };
      if (name === 'StartBuildCommand') {
        const b = { id: `mock-site:${builds.length + 1}`, startedAt: Date.now() };
        builds.push(b);
        return { build: asBuild(b) };
      }
      throw new Error('mock codebuild: unsupported command');
    },
  };

  const { deps } = makeDeps({ s3, codebuild, buildProject: 'mock-site' });
  // The real scheduling code (which jobs, when, in IST) over an in-memory Scheduler.
  const schedules = new FakeScheduler();
  if (failScheduling) schedules.failWith = Object.assign(new Error('mock: scheduling is failing'), { name: 'ThrottlingException' });
  deps.scheduler = new EndScheduler({ client: schedules, groupName: 'awsug-events', roleArn: 'arn:aws:iam::000000000000:role/mock-scheduler', buildProject: 'mock-site' });

  let publicUrl = '';
  const routes: { method: string; pattern: RegExp; keys: string[]; key: string; handler: ReturnType<typeof route> }[] = [];
  const add = (method: string, path: string, h: Handler) => {
    const keys: string[] = [];
    const pattern = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    routes.push({ method, pattern, keys, key: `${method} ${path}`, handler: route(h, () => deps) });
  };
  add('GET', '/content/:collection', list);
  add('GET', '/content/:collection/:id', get);
  add('PUT', '/content/:collection/:id', save);
  add('DELETE', '/content/:collection/:id', remove);
  add('POST', '/uploads', async (e, ctx) => {
    const r = await sign(e, ctx);
    const body = JSON.parse(r.body!);
    // Send the browser's form POST to this server instead of S3.
    return { ...r, body: JSON.stringify({ ...body, url: `${publicUrl}/__upload` }) };
  });
  add('GET', '/publish', publishStatus);
  add('POST', '/publish', publish);

  const cors = (req: IncomingMessage): Record<string, string> => ({
    'access-control-allow-origin': req.headers.origin ?? '*',
    'access-control-allow-headers': 'authorization, content-type, if-match, if-none-match',
    'access-control-allow-methods': 'GET, PUT, POST, DELETE, OPTIONS',
    'access-control-expose-headers': 'etag',
    vary: 'origin',
  });

  const send = (req: IncomingMessage, res: ServerResponse, r: ApiResult) => {
    res.writeHead(r.statusCode, { ...cors(req), ...(r.headers ?? {}) });
    res.end(r.body);
  };

  async function readBody(req: IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const started = Date.now();
    try {
      if (req.method === 'OPTIONS') return send(req, res, { statusCode: 204 });

      // Photos: the form POST that stands in for S3, and the processed files the site would serve.
      if (req.method === 'POST' && url.pathname === '/__upload') {
        const form = await new Request('http://localhost/', { method: 'POST', headers: req.headers as any, body: Readable.toWeb(req) as any, duplex: 'half' } as any).formData();
        const key = String(form.get('key') ?? '');
        const file = form.get('file') as File | null;
        if (!key.startsWith('uploads/') || !file) return send(req, res, { statusCode: 400, body: '<Error>bad upload</Error>' });
        uploads.set(key.slice('uploads/'.length), { bytes: Buffer.from(await file.arrayBuffer()), type: file.type || 'image/jpeg', readyAt: Date.now() + processMs });
        return send(req, res, { statusCode: 204 });
      }
      // Dev aid: which "switch to Past" jobs exist right now.
      if (req.method === 'GET' && url.pathname === '/__schedules') return send(req, res, { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify([...schedules.existing].map(([name, at]) => ({ name, at }))) });
      if (req.method === 'GET' && url.pathname.startsWith('/media/')) return serveMedia(req, res, url.pathname.slice('/media/'.length), uploads);

      const match = routes.map((r) => ({ r, m: r.pattern.exec(url.pathname) })).find((x) => x.r.method === req.method && x.m);
      if (!match) return send(req, res, { statusCode: 404, body: JSON.stringify({ error: { code: 'not_found', message: 'No such route.' } }) });

      const auth = req.headers.authorization;
      const claims = auth?.startsWith('Bearer ') ? { token_use: 'access', username: 'dev-organizer', sub: 'dev-sub', 'cognito:groups': '[organizers]' } : undefined;
      const event: ApiEvent = {
        routeKey: match.r.key,
        headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v])),
        pathParameters: Object.fromEntries(match.r.keys.map((k, i) => [k, decodeURIComponent(match.m![i + 1]!)])),
        queryStringParameters: Object.fromEntries(url.searchParams),
        body: req.method === 'GET' || req.method === 'DELETE' ? undefined : await readBody(req),
        requestContext: { authorizer: claims ? { jwt: { claims } } : undefined },
      };
      // API Gateway answers 401 itself when there is no token.
      const result: ApiResult = claims ? await match.r.handler(event) : { statusCode: 401, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Unauthorized' }) };
      if (!quiet) console.log(`${req.method} ${url.pathname} -> ${result.statusCode} (${Date.now() - started} ms)`);
      send(req, res, result);
    } catch (e) {
      console.error(e);
      send(req, res, { statusCode: 500, body: JSON.stringify({ error: { code: 'internal', message: 'Mock server error.' } }) });
    }
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  const actualPort = (server.address() as AddressInfo).port;
  publicUrl = `http://localhost:${actualPort}`;
  return {
    url: publicUrl,
    s3,
    schedules,
    uploads,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function seedContent(s3: FakeS3) {
  for (const collection of ['events', 'speakers', 'sponsors', 'organizers', 'posts']) {
    const dir = join(CONTENT_DIR, collection);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      s3.seed(`content/${collection}/${file}`, readFileSync(join(dir, file), 'utf8'));
    }
  }
}

const MIME: Record<string, string> = { '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png' };

function serveMedia(req: IncomingMessage, res: ServerResponse, path: string, uploads: Map<string, Upload>) {
  const h = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
  // Processed variant of an upload: <stem>-480.webp. Not available until "processing" has finished.
  const variant = path.match(/^(.*)-(480|960|1600)\.webp$/);
  if (variant) {
    const [stem] = [variant[1]!];
    const found = [...uploads.entries()].find(([k]) => k.replace(/\.[^.]+$/, '') === stem);
    if (found && Date.now() >= found[1].readyAt) {
      res.writeHead(200, { ...h, 'content-type': found[1].type });
      return res.end(found[1].bytes);
    }
  }
  // Placeholder artwork that ships with the site.
  const file = join(SAMPLE_MEDIA_DIR, path);
  if (file.startsWith(SAMPLE_MEDIA_DIR) && existsSync(file) && MIME[extname(file)]) {
    res.writeHead(200, { ...h, 'content-type': MIME[extname(file)]! });
    return res.end(readFileSync(file));
  }
  res.writeHead(404, h);
  res.end();
}

// Run directly: `npm run dev:mock`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startMockServer({ port: Number(process.env.PORT ?? 8787) });
  console.log(`Mock admin API (real handlers, in-memory S3) at ${server.url}`);
  console.log('Seeded from fixtures/sample-content. Changes live only while this process runs.');
}
