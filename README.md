# AWS UG Delhi NCR website

Static Astro site from ADR-002. This repo covers **Phase 1 (scaffold)**, **Phase 2 (content model and pages)** and the **design system** that sits on top of them.
Infrastructure (CDK), the admin and the build/IST automation come in later phases.

```bash
npm install
npm run dev              # http://localhost:4321
npm run build            # static output in dist/, then writes csp-hashes.json
npm run check            # type check
npm run design:contrast  # WCAG AA check of every token pair, both themes
npm run design:lint      # lint DESIGN.md with Google's design.md CLI
```

## Design system

**[DESIGN.md](DESIGN.md) is the source of truth** for look and feel: concept (a Delhi Metro line map), palette, type, components, and the paired Do/Don't rules. Read it before changing any UI.

- Tailwind CSS v4 and Starwind UI (button, badge; sources are copied into `src/components/starwind/` and owned by us).
- Tokens live in `src/styles/tokens.css` using shadcn/Starwind variable names, so the Phase 5 React admin can import the same file.
- Fonts (self-hosted, OFL): Anek Latin for display, Atkinson Hyperlegible Next for text and Mono for data.
- **Light by default.** Dark only when the visitor presses the toggle, and the choice is remembered. The OS colour-scheme setting is ignored on purpose.
- **Logo.** The chapter's Delhi skyline hexagon, cut from the old site's logo without the AWS wordmark: `npm run brand:badge -- --old ../old-site` writes `src/assets/brand/ug-badge.png` (used by the generated cards and `/logo-512.png`) and the header and favicon sizes in `public/brand/`.
- **Motion.** Twelve patterns (marquee, photo ribbon, countdown board, count-up, card-to-page transitions, line drawing and more), all off with reduced motion and every loop pausable; see DESIGN.md, "Motion". Code in `src/styles/motion.css`, `src/scripts/motion.ts` and `public/scripts/page-transitions.js`; `npm run test:motion` tests the countdown and count-up logic.
- **Pages and components.** Every page is built from shared pieces in `src/components/` (`PageHeader`, `EventCard`, `EventLine`, `PersonCard`, `EmptyState`, `SectionNav`, `StatStrip`, `PartnerTile`, `SiteFooter`, `Icon` and more; see DESIGN.md, "Components"). Every list has a designed empty state, so a site with no upcoming events or no posts never shows a bare box. **Speakers carry no job title or company** (they change too often): the schema has no such fields, and a speaker is introduced as "Spoke at 3 events", computed from the events. The official AWS logo appears, unaltered, only in the partners lists.
- No inline styles and a single inline script (the theme bootstrap), so Phase 3 can ship a strict CSP. `npm run build` fails if an inline style, `<style>` block or inline event handler appears, and writes the script hash to `csp-hashes.json` for the CloudFront policy.

## Infrastructure

`infra/` holds the AWS CDK app (Media, Site, Build, Admin and AdminApp stacks, the CloudFront URL-rewrite function, the resize Lambda, and the admin API: Cognito, HTTP API and six Lambdas). `admin/` is the React admin app organizers use to edit content; see [admin/README.md](admin/README.md). It is a separate package with its own `node_modules`; start with [infra/README.md](infra/README.md) for the deploy runbook.

## Layout

| Path | What |
|---|---|
| `admin/` | The admin web app (React): forms for every collection, photo upload, publish |
| `infra/` | AWS CDK stacks, CloudFront function, resize Lambda, tests |
| `DESIGN.md` | Design system |
| `src/styles/` | `tokens.css`, `starwind.css` (Tailwind entry and base), `metro.css`, `prose.css` |
| `src/components/` | Layout parts, metro-line components (`EventLine`, `AgendaLines`, `NcrMap`), `starwind/` |
| `src/schema/index.ts` | Zod content schema. No Astro imports, so the admin and save Lambda can reuse it later |
| `src/content/<collection>/*.json` | `events`, `speakers`, `sponsors`, `organizers`, `posts` (JSON) and `pages` (Markdown) |
| `src/data/site.json` | Contact email, social links, site description |
| `src/lib/` | IST time helpers, content loading and validation, JSON-LD, `.ics`, markdown, media URLs, CTA logic |
| `src/pages/` | Routes: `/`, `/events/`, `/events/past/`, `/events/<year>/`, `/events/<year>/<slug>/`, `/community-day/`, `/speakers/`, `/sponsors/`, `/blog/`, `/about/`, `/code-of-conduct/`, `/privacy/`, `/contact/` |

## Rules the build enforces

- Every datetime needs an explicit offset (`2026-11-14T16:00:00+05:30`); offset-less values fail the build.
- No `joinUrl` field exists, and Zoom, Meet, Teams and Chime links anywhere in an event, speaker or post fail the build.
- Speakers with `consent.publish: false` get no page, photo, bio or `performer` markup.
- Slugs referenced from events and posts (speakers, sponsors, hosts, authors) must exist.
- Upcoming vs Past is computed from `end` at build time. The publish build runs just after each event ends (a job per event, in IST), nightly, and on Publish; a small script in the page covers a late build.
- `buildspec.yml` is the publish build: content from S3, validation (the same schema the admin uses), then upload. A bad item or a stale CSP hash stops it before anything is uploaded.

## SEO (Phase 7)

- **Link previews.** Every page gets a generated 1200x630 PNG (`/og/...`), drawn at build time with Satori and resvg in the site's own fonts. Events also get 16:9, 4:3 and 1:1 versions for Google's Event markup; posts and speakers get their own card. A real event or post photo takes over when one is set. Nothing is hand-made, so a new event never needs a design step. The Organization logo (`/logo-512.png`) and `apple-touch-icon.png` come from the same code (`src/lib/og.ts`).
- **Feed and sitemap.** `/rss.xml` is the blog feed (linked from every page's `<head>`); `@astrojs/sitemap` writes `sitemap-index.xml`, and `robots.txt` points at it.
- **Fonts.** The two body/display fonts are preloaded from `BaseHead.astro` so text does not wait for the stylesheet.
- **Search Console and Bing.** Add the HTML-tag codes to `src/data/site.json` as `"verification": { "google": "...", "bing": "..." }`; the tags appear on the next build. Submit `sitemap-index.xml` in both consoles after the first deploy.
- **Old URLs.** `infra/redirects.json` maps the previous site's routes (`/acd2024`, `/gameday2025`, ...) to their new pages with a single 301, in any capitalisation. Each event target (for example `/events/2024/community-day-delhi-2024/`) is a migrated event with exactly that id and year (Phase 8, below); the audit warns if a target ever stops existing.
- **The audit.** `scripts/seo-check.mjs` runs after every build (`npm run build`, and so on every Publish) and fails it when a page would hurt search: broken basics (exactly one `<title>` and `<h1>`, a description of at most 160 characters, `lang`), a canonical that is not absolute and self-consistent, missing link-preview tags or image, broken internal links, new-tab links without `noopener`, invalid Event/BlogPosting/Organization data (offsets, images, address), a page missing from the sitemap, or a bad `robots.txt`. A failure stops the publish before anything is uploaded, like any other build error. Run `npm run seo:check` after a build to see it alone, and `SEO_STRICT_REDIRECTS=1 npm run seo:check` to also require every old-route target to exist (use this before launch). `npm run test:seo` proves the audit itself fails on broken output.
- **Descriptions.** Event `summary`, post `description`, page `description` and the site description are all capped at 160 characters by the schema, because they become the meta description; the admin shows the counter.
- **Left out on purpose.** Analytics: a cookieless provider (Plausible, Cloudflare Web Analytics, or CloudFront logs) needs a decision on cost and privacy wording, and a CSP change for any third-party script. Google Business Profile does not apply to a community group without a premises.

## Migrating the previous site (Phase 8)

`src/content/` now holds the real history of the group, converted from [Sumaniac28/awsugdelhincr](https://github.com/Sumaniac28/awsugdelhincr): 11 events (up to and including Community Day 2025), 37 speakers, 7 sponsors and partners, the 10-person organizing team and the 13 further volunteers who helped at Community Day 2025, with 170 photos. Community Day 2025 comes with its full agenda. Nothing was retyped: `scripts/migrate/` reads the old data files directly, maps them onto the new schema and validates every document with the same Zod schema as the admin.

```bash
git clone https://github.com/Sumaniac28/awsugdelhincr.git ../old-site
git -C ../old-site checkout dev                          # NOT main: main stops in September 2025, before Community Day 2025
npm run migrate -- --old ../old-site                     # speaker photos stay private (no consent recorded)
npm run migrate -- --old ../old-site --legacy-consent    # once organizers agree the old site's publication stands
npm run migrate:status                                   # what still needs an organizer; exits 1 while anything is open
npm run test:migrate                                     # OLD_SITE_DIR=../old-site also migrates the real repo end to end
```

- **What it writes.** Content JSON to `src/content`; the review report to `migration/REPORT.md` (read it: every choice and conflict is listed); media to `migration/` (originals, public variants, private variants); and the public variants to `public/media` for local preview. `migration/` and `public/media` are git-ignored because production serves photos from the media bucket. It replaces only files an earlier run wrote and refuses to touch anything else.
- **Facts the old site never had** live in `scripts/migrate/facts.json`: event end times, venue addresses, summaries, sponsor tiers, and a `confirmed` flag on each guess. Edit the file, re-run `npm run migrate`, and the report updates. Unconfirmed values are listed by `migrate:status`, and the launch gate fails on them (below).
- **Ids and years are fixed by `infra/redirects.json`**: the old `/acd2024` and the other nine event links now reach their new pages in one hop (a test checks that every redirect target is a migrated event, and the reverse).
- **Speaker consent.** The old site published names and photos but recorded no consent, so by default `consent.publish` is `false`: speakers appear by name only, with no photo, page or markup, and their photos are not copied to any public place. `--legacy-consent` records consent as "already published on the previous site; organizers confirmed" and publishes them. Per-person changes are made in the admin afterwards.
- **Sponsorship packages and deck.** The Platinum, Gold and Silver packages from the old "Call for Sponsors" page are in `src/data/sponsorship.json` (validated at build time), and the 2025 deck is `public/sponsorship/community-day-sponsorship-deck-2025.pdf`. Both show on the Sponsors page. They are the 2025 edition's details (USD plus tax): update the file and the PDF for the next edition.
- **Not migrated, on purpose:** the placeholder volunteers (John Doe...), the WhatsApp group link and the old sponsorship poster image. Photo alt text is generic ("Event: photo 3 of 10") until someone describes each photo.
- **Upload** to the deployed buckets with `npm run migrate:upload` (dry run by default; see [infra/README.md](infra/README.md)). It is a one-time load: afterwards the admin is the only editor.
- **Launch gate.** `SEO_LAUNCH=1 npm run seo:check` after a build fails on any unconfirmed address, `TBC` text, sample content or the placeholder domain, and requires every old-route redirect target to exist. Run it with the real `SITE_URL` before pointing the domain.

## Sample data

The fictional placeholder content used while building (upcoming meetups, a Community Day with tracks and agenda, sample speakers and sponsors, two blog posts) now lives in `fixtures/sample-content/`, so it never reaches the real site. To see the upcoming-event and agenda designs, copy those folders into `src/content/` (and delete them again afterwards). `public/media/samples/` holds the flat SVG posters they use.
Set `SITE_URL` (see `.env.example`) before a real build; the fallback domain is a placeholder and the launch gate rejects it.

## Notes

- Astro 6.4.8 is pinned (ADR-002) and Vite is pinned to 7.3.7 so `@tailwindcss/vite` and Astro share one Vite. Astro 6.4.8 has open security advisories that only Astro 7 fixes; Astro 7 needs Node 22.23.4 or newer.
- No AWS logo, smile, Amazon Ember or `#232F3E` + `#FF9900` pairing (AWS Trademark Guidelines §10). The "AWS User Group" name and any `aws` domain still need written confirmation from the AWS user group programme.

## Not yet done

Per the ADR these belong to later phases: launch QA (9) and runbooks (10). Phase 8 is done locally (the upload and the organizers' confirmations need the deployed account and people, see above). Analytics is an open decision (see SEO above). Phases 3 to 6 are written and tested but **not deployed** (it needs an AWS account and a domain decision); `PUBLIC_MEDIA_BASE` stays `/media`, which the Site stack serves from the media bucket.
