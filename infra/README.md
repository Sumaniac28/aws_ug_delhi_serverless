# Infrastructure (AWS CDK)

Phases 3 to 6 of ADR-002: the **Media** and **Site** stacks (plus a **Certificate** stack when a custom domain is used), the **Admin** back end (Cognito, HTTP API, six Lambdas) the **AdminApp** hosting for the React admin in [../admin](../admin/README.md), and the **Build** stack that publishes the site and moves events to Past on time.
Everything is TypeScript CDK, so the next organizer team can rebuild it from this repo.

| Stack | Region | What it creates |
|---|---|---|
| `AwsugMedia` | `ap-south-1` | Versioned **content** bucket (JSON, rollback by S3 version). **Media** bucket (`uploads/` private and short-lived, `media/` public through CloudFront). **Resize Lambda** (Node 22, arm64, sharp): `uploads/x.jpg` becomes `media/x-480.webp`, `-960.webp`, `-1600.webp` with EXIF/GPS stripped |
| `AwsugCertificate` | `us-east-1` | ACM certificate, DNS-validated (only with a domain; CloudFront requires us-east-1) |
| `AwsugBuild` | `ap-south-1` | The **publish build** (CodeBuild: content from S3, validate, build, upload, clear the cache), the **schedule group** for per-event "switch to Past" jobs, the role Scheduler uses, and the **nightly rebuild** at 00:17 IST. Created only with `githubRepo`. See [Publishing and Upcoming to Past](#publishing-and-upcoming-to-past-phase-6) |
| `AwsugAdmin` | `ap-south-1` | Invite-only **Cognito** user pool (MFA required) with an `organizers` group, an **HTTP API** that verifies its tokens, and six **Lambdas**: list, get, save, delete, sign upload, publish. See [Admin API](#admin-api-phase-4) |
| `AwsugAdminApp` | `ap-south-1` | Hosts the admin web app: private bucket, its own CloudFront distribution, `noindex` header, strict CSP naming only its API, Cognito and the media bucket, SPA routing, and a generated `config.json`. See [Hosting the admin app](#hosting-the-admin-app-phase-5) |
| `AwsugSite` | `ap-south-1` | Private **site** bucket, CloudFront with Origin Access Control, the **URL-rewrite function**, strict **security headers**, `/media/*` behaviour, Route 53 A/AAAA records (only with a domain) |

## What the design guarantees

- **Nothing is public except through CloudFront.** Every bucket blocks public access and requires TLS. CloudFront reads the site bucket (scoped to this distribution) and `media/*` only; `uploads/` is unreachable from the web.
- **Raw uploads live for one day.** They can carry GPS and device data; the resize Lambda strips it from everything it publishes.
- **One URL per page.** The function maps `/events/x/` to `index.html`, 301s slashless URLs to the slash form, and sends `www`, `*.cloudfront.net` and any other host to the canonical host. Old-site routes come from `infra/redirects.json` (validated by `lib/redirects.ts`: absolute sources, lowercase targets ending in `/`, no duplicates, no chains or loops) and are matched case-insensitively with or without a trailing slash, in a single hop even from `www`. The rendered function must stay under CloudFront's 10 KB limit; a test checks it.
- **Strict CSP.** `script-src 'self'` plus the SHA-256 of the one inline script (the theme bootstrap), `style-src 'self'`, no third parties. The hash is read from `../csp-hashes.json`, which `npm run build` writes; synth refuses to run without it.
- **Least privilege.** The resize function can `GetObject` on `uploads/*` and `PutObject` on `media/*`, nothing else. Stacks are never deleted with their data (`RETAIN`).
- **Stacks are independent.** Media grants CloudFront read access by account-wide wildcard instead of by distribution ARN, so Media never depends on Site (that would be a dependency cycle).

## Admin API (Phase 4)

The admin app (Phase 5) talks to this API with a Cognito **access token** in `Authorization: Bearer ...`. Content is the same JSON the Astro build reads, validated by the **same Zod schema** (`../src/schema/index.ts`, bundled into the Lambdas), so an organizer cannot save anything the site build would reject.

| Route | Does |
|---|---|
| `GET /content/{collection}` | List items with a short summary each (`events`, `speakers`, `sponsors`, `organizers`, `posts`) |
| `GET /content/{collection}/{id}` | One item; its `ETag` is its version |
| `PUT /content/{collection}/{id}` | Create (`If-None-Match: *`) or update (`If-Match: <etag>`). One of the two is required (428 otherwise) |
| `DELETE /content/{collection}/{id}` | Delete; adds an S3 delete marker, the history stays |
| `POST /uploads` | Presigned POST for a photo: body `{folder, filename, contentType}`, returns `{url, fields, mediaKey, variants}` |
| `POST /publish`, `GET /publish` | Start a site build (one at a time) / report the latest. `503` until the Build stack exists (Phase 6) |

Errors are JSON: `{ "error": { "code", "message", "details" } }`. The codes the app should handle: `conflict` (412, someone else saved first), `invalid_document` (422, with field paths), `missing_references` (422), `in_use` (409, cannot delete, names what still uses it), `precondition_required` (428).

**Guarantees**

- **Invite-only, MFA always.** Self sign-up is off and an authenticator-app code is required at every sign-in. Offboarding is disabling the user.
- **Every route is authenticated.** API Gateway verifies the token (signature, issuer, expiry, client). A JWT authorizer cannot test group membership, so each handler then requires an *access* token from a member of `organizers` (an ID token is refused). ADR-002 had API Gateway doing the group check; this is the closest a JWT authorizer allows.
- **No lost updates.** Saves are conditional on the ETag the editor last saw (S3 conditional writes), so two organizers cannot silently overwrite each other. The bucket is versioned: every save and delete can be rolled back, and the editor is recorded on each version (`edited-by`).
- **No broken publishes.** The API refuses an event that names a speaker, sponsor or host that does not exist, and refuses to delete something other content still uses.
- **No join links, ever.** The shared schema rejects `joinUrl` fields and Zoom/Meet/Teams/Chime links in any text.
- **Least privilege per route.** List/Get read content only; Save reads and writes it; Delete only adds delete markers (never `DeleteObjectVersion`); SignUpload can only put under `uploads/`; Publish can only touch the one build project. Throttled to 20 requests a second.
- **Safe uploads.** Presigned POSTs pin the exact key, content type and uploader, cap size at 25 MB and expire in 5 minutes. Each upload gets a fresh random key.

### Inviting and removing organizers

```bash
POOL=<UserPoolId from the AwsugAdmin outputs>
aws cognito-idp admin-create-user --user-pool-id "$POOL" --username asha \n  --user-attributes Name=email,Value=asha@example.org Name=email_verified,Value=true \n  --desired-delivery-mediums EMAIL
aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL" --username asha --group-name organizers
```

The organizer gets an email with a temporary password (valid 7 days), then chooses a password and sets up an authenticator app on first sign-in. To remove someone:

```bash
aws cognito-idp admin-disable-user --user-pool-id "$POOL" --username asha
aws cognito-idp admin-user-global-sign-out --user-pool-id "$POOL" --username asha
```

The username is what appears in `edited-by` on each saved version, so use something recognisable.

## Publishing and Upcoming to Past (Phase 6)

Saving in the admin changes only the content bucket. The **publish build** (`AwsugBuild`, a CodeBuild project) turns that into the live site by running [`buildspec.yml`](../buildspec.yml):

1. Pull events, speakers, sponsors, organizers and posts from the content bucket into `src/content/` (replacing the repo's own copy, which is only the migrated starting point; About, Code of Conduct, Privacy and site settings still come from the repo).
2. `npm run build`: validates every item against the same schema as the admin, including the no-join-links rule and that every referenced speaker, sponsor and host exists. **A bad item fails the build here, before anything is uploaded, so the live site is untouched.**
3. `scripts/verify-csp.mjs`: refuses to publish if the site's one inline script no longer matches the hash the deployed CSP allows (otherwise every page would load with a policy blocking it).
4. Upload hashed assets, then pages (`--delete`), then clear CloudFront.

Three things start it, one build at a time (the project allows one, and Publish reports one already running):

| Trigger | When |
|---|---|
| **Publish** button | An organizer is done editing |
| **One-time job per event** | Created or moved whenever an event is saved: one minute after it ends, in **Asia/Kolkata**. So the event moves from Upcoming to Past within minutes of finishing. The job deletes itself after it runs. Drafts and events already over get none; deleting an event removes its job |
| **Nightly job** | 00:17 IST, a safety net for anything the above missed |

A third layer is in the pages themselves: a small script (`src/lib/phase-fallback.ts`) that, if a build is late, marks an already-ended event as Past and swaps its Register button for a note, using each event's own end instant. The HTML underneath is unchanged for search engines.

**If a job cannot be created** (for example Scheduler is throttling), the content is still saved and the organizer sees a note; the nightly job still flips the event.

**Set up**

- `-c githubRepo=<owner>/<repo>` (and `-c githubBranch=...`, default `main`) creates the build. Without it the admin works but Publish and the schedules stay off.
- **Public repository:** nothing more. **Private repository:** authorize CodeBuild once, in the account, outside the code: `aws codebuild import-source-credentials` (or connect GitHub from the CodeBuild console). No token is stored in this repo or in CDK.
- Do **not** enable build caching: Astro's content cache does not forget deleted files, so a reused cache could republish a deleted event or speaker. A fresh checkout every build avoids it.
- A new `AwsugBuild` stack means redeploying: `npx cdk deploy --all`.

**Try it without AWS:** `npm run rehearse` saves content through the real admin handlers, builds a throwaway copy of the site exactly as the buildspec does, checks the result (including that drafts are excluded), and shows that an invalid document or a dangling reference stops the build.

**First-deploy checklist** (these depend on real AWS behaviour that tests cannot cover):

1. Press **Publish** on the dashboard. The build should start (CodeBuild console) and succeed. If it fails at install, check the Node 22 runtime of the build image.
2. Create an event in the admin that ends about five minutes from now, with Draft unticked. Run `aws scheduler get-schedule --group-name awsug-events --name awsug-end-<id>` and confirm `ScheduleExpressionTimezone` is `Asia/Kolkata` and the expression is one minute after the end time in IST.
3. Wait. A build should start by itself at that time, the schedule should have deleted itself, and the event should now be listed under Past.
4. Press Publish twice quickly: the second answers "already running".
5. Change the theme script (or its hash) and publish: the build should stop with the `verify-csp` message and leave the site as it was.

## Hosting the admin app (Phase 5)

The admin is a static React app ([../admin](../admin/README.md)). The **AdminApp** stack serves it from its own CloudFront distribution and, on each deploy, uploads `admin/dist` plus a `config.json` it generates from the other stacks' outputs (API address, Cognito sign-in address and client id, site address). So the same build works in any environment and nothing is baked into the JavaScript.

- **Kept private to organizers' use, not hidden.** The page is public like any website, but it carries `X-Robots-Tag: noindex`, cannot be framed, and does nothing without signing in.
- **Strict CSP:** scripts and styles from itself only; it may connect to exactly its API, the Cognito sign-in service and the media bucket (photo uploads). Checked against the real build: no violations, and injected inline script and style are blocked.
- **With a domain:** set `adminDomainName` (for example `admin.example.org`, inside the hosted zone). It gets its own records and a place on the same certificate, and becomes the default `adminOrigins`, so CORS, sign-in redirects and photo uploads all follow it automatically.
- **Without a domain (first try-out), deploy twice.** Cognito must be told the admin's address, which does not exist until the AdminApp stack has been created:
  1. `npx cdk deploy --all`, then note the `AdminUrl` output of `AwsugAdminApp` (a `https://d....cloudfront.net` address).
  2. `npx cdk deploy --all -c adminOrigins=<that address>`. Now sign-in, API calls and photo uploads accept it.

**Build order.** `cdk synth` needs three things to exist first: the site build (`npm run build` in the repo root, for `csp-hashes.json`), the resize Lambda (`npm run build:lambda`), and the admin build (`cd admin && npm run build`). Synth stops with a clear message if one is missing.

**Try the admin locally with no AWS:** `cd admin && npm run dev:mock` and `npm run dev` (see the admin README).

## One-time setup (about an hour, in the console)

From ADR-002, before the first deploy: a group-owned AWS account on a shared mailbox, MFA on root, IAM Identity Center for at least two admins, a budget alarm (for example ₹500 a month) emailing all organizers, and (when ready) the domain delegated to Route 53. Then, with credentials for that account:

```bash
cd infra
npm install
npx cdk bootstrap aws://<ACCOUNT>/ap-south-1 aws://<ACCOUNT>/us-east-1   # us-east-1 only needed with a domain
```

## Deploy

```bash
# 1. In the repo root: build the site (writes csp-hashes.json), then the admin app
npm run build
(cd admin && npm install && npm run build)

# 2. In infra/: package the resize Lambda (installs the Linux/arm64 sharp binary, no Docker)
cd infra && npm run build:lambda

# 3a. Try it on the default *.cloudfront.net address (no domain decision needed yet)
npx cdk deploy --all

# 3b. Or with the real domain, once the trademark query is answered
npx cdk deploy --all \
  -c domainName=example.org -c hostedZoneId=Z0123456789ABC -c hostedZoneName=example.org \
  -c wwwRedirect=true -c adminDomainName=admin.example.org -c cognitoDomainPrefix=awsug-delhi-ncr \
  -c githubRepo=awsug-delhi-ncr/website
```

`adminDomainName` is the admin app's own address (and sets `adminOrigins` for you). `adminOrigins` (comma-separated) is where the admin app is served from; set it yourself only for a cloudfront.net address. It drives CORS for the API and for browser photo uploads, and the sign-in redirect URLs; until it is set, only `http://localhost:5173/` can sign in. `cognitoDomainPrefix` names the hosted sign-in page and must be unique across AWS (default `awsug-delhi-ncr-<account>`). The same keys can live under `"context"` in `cdk.json`. `cdk diff` shows changes first. The outputs include `SiteBucketName`, `DistributionId`, `SiteUrl`, `MediaBucketName` and `ContentBucketName`.

## Loading the migrated content (once, Phase 8)

The previous site's events, speakers, sponsors, team and photos are converted locally by `npm run migrate` (see the root README). After the first deploy, and after `npm run migrate:status` reports nothing left to confirm, load them into the two buckets:

```bash
# 1. See exactly what would run (nothing is uploaded without --execute)
npm run migrate:upload -- --media-bucket <MediaBucketName> --content-bucket <ContentBucketName> --profile <your-profile>

# 2. Run it
npm run migrate:upload -- --media-bucket <MediaBucketName> --content-bucket <ContentBucketName> --profile <your-profile> --execute
```

It uploads the public photo variants to `media/` with the same headers the resize Lambda uses, and the content to `content/<collection>/`. Original files and speaker photos without recorded consent are never uploaded. It refuses to run if the content bucket already holds items, so it can never overwrite what organizers have edited in the admin. Then press Publish in the admin. Migration is a one-time load: after it, the admin is the only place content is edited.

## Publishing by hand (fallback)

Normally the publish build does this (see [Publishing and Upcoming to Past](#publishing-and-upcoming-to-past-phase-6)). If it is ever unavailable, the same steps work from a laptop, from the repo root after `npm run build`. Assets go first so a page never points at a file that is not there yet, and `--delete` runs last. Note that this publishes the repo's own `src/content`, not what organizers saved in the admin, unless you first sync the content bucket into it as `buildspec.yml` does:

```bash
SITE_BUCKET=<SiteBucketName>  DIST_ID=<DistributionId>
aws s3 sync dist/_astro "s3://$SITE_BUCKET/_astro" --cache-control "public,max-age=31536000,immutable"
aws s3 sync dist "s3://$SITE_BUCKET" --delete --exclude "_astro/*" --cache-control "public,max-age=300"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*"
```

## Check before and after deploying

```bash
npm test             # 167 tests: routing, images, every stack property, and the whole admin API against an in-memory S3
npm run typecheck
npx cdk synth --quiet && npm run smoke   # loads the real bundled Lambdas in Node 22 and calls them
npm run serve:dist   # serves ../dist at http://localhost:4400 with the real function and headers
```

`serve:dist` is how to see whether the strict CSP breaks anything: open the console and look for violations. (Use trailing-slash URLs locally; the function always redirects to `https`.)

## Things to know

- **The default `*.cloudfront.net` address is for trying the stacks, not for launch.** AWS fixes its TLS policy at TLSv1 there; TLS 1.2 or newer is only enforced with a custom domain and certificate.
- **Changing the inline theme script changes its hash.** Rebuild the site and redeploy the Site stack, or the CSP will block it and every page will flash light before applying dark. `npm run build` prints the current hash.
- **Replace a photo by uploading under a new key.** Processed variants are cached as `immutable` for a year.
- **iPhone HEIC photos are skipped** (sharp's prebuilt binaries cannot decode HEIC). The admin (Phase 5) should convert to JPEG in the browser before upload.
- **CORS for browser uploads** is only added when `adminOrigins` is set; until then browser photo uploads (presigned POSTs) will be blocked.
- The resize function has no dead-letter queue; failures show in its CloudWatch log group (14-day retention). Add one if uploads ever fail silently.
- CloudFront access logs are not enabled (cost). Turn them on if you need traffic analysis beyond cookieless analytics, which is still an open decision (see the SEO section of the root README).

## Not here yet

- **Anything in Phase 6 has been exercised against real AWS.** Unit tests, a bundle smoke test and a local rehearsal cover the logic; the [first-deploy checklist](#publishing-and-upcoming-to-past-phase-6) covers the rest.
- **Editing About, Code of Conduct, Privacy and site settings** through the API. They are Markdown and a single JSON file, not collections; decide in Phase 5 how the admin edits them.
- **A GitHub Actions workflow with OIDC** for deploys (not started; deploys are manual for now).
- Nothing in Phase 4 has been deployed. Tests run against an in-memory S3; the first real deploy is the first time S3 conditional writes, Cognito and API Gateway are exercised together, so expect to try a save, a conflicting save and an upload by hand then.
