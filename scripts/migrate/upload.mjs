// Loads the migrated content and media into the deployed buckets. Run it once, after the first deploy and after
// organizers have confirmed what npm run migrate:status lists. It needs the AWS CLI and credentials for the account.
//
//   npm run migrate:upload -- --media-bucket <name> --content-bucket <name> [--profile p] [--region r]
//   ... --execute      do it (without this flag it only prints what it would run)
//
// Both bucket names are outputs of the CDK stacks (see infra/README.md). What goes where:
//   migration/bucket/media/**     -> s3://<media>/media/**   the public WebP variants, same headers as the resize Lambda
//   src/content/<collection>/*.json -> s3://<content>/content/<collection>/   what the admin edits and the publish build reads
// Never uploaded: migration/originals and migration/private (speaker photos without recorded consent).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const COLLECTIONS = ['events', 'speakers', 'sponsors', 'organizers'];

export function plan({ mediaBucket, contentBucket, profile, region }) {
  const common = [...(profile ? ['--profile', profile] : []), ...(region ? ['--region', region] : [])];
  const steps = [];
  const media = join(ROOT, 'migration/bucket/media');
  if (existsSync(media)) {
    steps.push({
      label: 'public photo variants',
      args: ['s3', 'sync', media, `s3://${mediaBucket}/media`, '--content-type', 'image/webp', '--cache-control', 'public, max-age=31536000, immutable', '--only-show-errors', ...common],
    });
  }
  for (const c of COLLECTIONS) {
    const dir = join(ROOT, 'src/content', c);
    if (!existsSync(dir) || !readdirSync(dir).some((n) => n.endsWith('.json'))) continue;
    steps.push({
      label: `${c} content`,
      args: ['s3', 'sync', dir, `s3://${contentBucket}/content/${c}`, '--exclude', '*', '--include', '*.json', '--content-type', 'application/json', '--cache-control', 'no-store', '--metadata', 'edited-by=migration', '--only-show-errors', ...common],
    });
  }
  return steps;
}

/** The content bucket is the source of truth once organizers use the admin, so never overwrite one that has items. */
export const emptyCheck = ({ contentBucket, profile, region }) => ({
  label: 'content bucket is empty',
  args: ['s3api', 'list-objects-v2', '--bucket', contentBucket, '--prefix', 'content/', '--max-items', '1', '--query', 'length(Contents || `[]`)', '--output', 'text', ...(profile ? ['--profile', profile] : []), ...(region ? ['--region', region] : [])],
});

function parseArgs(argv) {
  const a = { execute: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--execute') a.execute = true;
    else if (k === '--force') a.force = true;
    else if (k === '--media-bucket') a.mediaBucket = argv[++i];
    else if (k === '--content-bucket') a.contentBucket = argv[++i];
    else if (k === '--profile') a.profile = argv[++i];
    else if (k === '--region') a.region = argv[++i];
    else throw new Error(`Unknown option ${k}`);
  }
  if (!a.mediaBucket || !a.contentBucket) throw new Error('Give --media-bucket and --content-bucket (the bucket names from the CDK stack outputs).');
  for (const b of [a.mediaBucket, a.contentBucket]) if (!/^[a-z0-9][a-z0-9.-]{2,62}$/.test(b)) throw new Error(`"${b}" is not a valid bucket name`);
  return a;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const steps = plan(args);
  const show = (s) => `aws ${s.args.map((x) => (/[\s`|*]/.test(x) ? JSON.stringify(x) : x)).join(' ')}`;
  if (!args.execute) {
    console.log('Dry run. Nothing is uploaded. It would run:\n');
    console.log(`  ${show(emptyCheck(args))}   (must report 0 unless --force)`);
    for (const s of steps) console.log(`  ${show(s)}`);
    console.log('\nAdd --execute to run these.');
    return;
  }
  if (!args.force) {
    const r = spawnSync('aws', emptyCheck(args).args, { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`Could not read the content bucket: ${r.stderr.trim() || r.error?.message}`);
    if (r.stdout.trim() !== '0') throw new Error('The content bucket already holds items (organizers may have started using the admin). Nothing was uploaded. Use --force only if you are sure.');
  }
  for (const s of steps) {
    console.log(`Uploading ${s.label}...`);
    const r = spawnSync('aws', s.args, { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`Failed while uploading ${s.label}`);
  }
  console.log('Done. Press Publish in the admin (or start the build project) to put the migrated site live.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
