# Admin app

The web app organizers use to edit the AWS UG Delhi NCR website (Phase 5 of ADR-002). React 19, Vite, Tailwind v4 and React Router. It talks to the admin API from Phase 4 ([../infra](../infra/README.md)) and is styled from the **same design system as the public site** ([../DESIGN.md](../DESIGN.md)): it imports `../src/styles/tokens.css`, the Tailwind theme and the base styles directly, so a design change lands in both.

```bash
# once, in the repo root, then here (the admin imports the site's schema and styles from the root)
npm install
cd admin && npm install

npm run dev:mock   # terminal 1: local API on :8787 (the REAL Phase 4 handlers over an in-memory S3, seeded from fixtures/sample-content, the fictional sample records)
npm run dev        # terminal 2: the app on http://localhost:5173, no sign-in needed
npm test           # 102 tests
npm run build      # type-check, then dist/ (what the CDK AdminApp stack deploys)
```

## What organizers can do

| Area | |
|---|---|
| **Dashboard** | The next event, quick actions (new event, add photos to the last event, add a speaker, write a post), what is waiting to go live, recent edits, items that need fixing, and drafts. |
| **Publish** | One button in the left menu, on every page. It only works when something was saved or deleted since the last successful build, asks first by listing exactly what will go live, and shows the build's progress. The server refuses a pointless build too (`409 nothing_to_publish`). |
| **Events, speakers, sponsors, organizers, blog posts** | Lists with search and filters (events are cards with their cover photo). Create, edit, delete. The event form is one page with a steps list on the left (The basics, When and where, Cover photo, Registration, Speakers and agenda, Partners, Description and extras, then the after-the-event steps). A few fields appear only when they matter: venue (not for online events), the old start time (only when rescheduled), "Opens on" (only when registration is not open yet). |
| **Create where you need it** | Speakers, hosts and sponsors can be searched in the event form, and a person who does not exist yet is added in a pop-up without leaving the page. |
| **Photos** | **Cover photo**: upload one, or choose one of the event's own photos. **Event photos**: pick or drag many at once (up to 100); they upload three at a time with progress, land in file-name order, and can be set as the cover, reordered, described and removed. Big photos are shrunk in the browser first. Each goes straight to S3 through a signed link, is resized and stripped of location data, and appears once processed. |
| **Tickets** | Optional ticket types per event (name, price in rupees, perks, a note, a link, "most popular"), each with a **Sold out** switch that stays visible on the folded card. The next event on the dashboard lists them with the same switch, so "we just sold out of Early bird" is one click and then Publish. |
| **What attendees said** | The feedback numbers (responses, average rating, would recommend), quote cards with a star rating and a "show large" mark, and a box to paste many quotes at once (one per line, " - attribution" at the end). |
| **Blog posts** | A formatting toolbar, write / preview / side by side, **Insert photo** (uploads, asks what it shows, drops it at the cursor), tag chips with suggestions, a cover image, author with "New host", dates and related event. Only our own uploads may appear in a post. |
| **Drafts** | Events and posts have a "Show on the website" switch next to Save. Off means a draft: saved but kept off the public site. |
| **Shortcuts** | Start a new event from a past one (copies what repeats), paste a registration link and the site (Meetup, Luma, Konfhub) is filled in, Ctrl or Cmd + S saves, "View on the website" opens the public page. |
| **Upcoming to Past** | Nothing to do: saving an event schedules the site to rebuild just after it ends. If that cannot be scheduled the editor says so (the nightly rebuild still catches it). |

## Behaviour worth knowing

- **Same rules as the site.** The forms validate with the site's own Zod schema (`../src/schema`), so anything the form accepts, the API and the site build accept. Messages are translated into plain English ("This is required.", "Enter a full web address, starting with https://").
- **No lost work.** Every save is based on the version the editor loaded. If someone else saved first, you are told, and can load their version; nothing is overwritten. Leaving a page with unsaved changes asks first.
- **Times are India time.** Date fields are entered and shown in IST and stored with `+05:30`, whatever the organizer's computer clock says.
- **No broken publishes.** The API refuses to delete a speaker, sponsor or organizer that other content still uses, and refuses an event naming one that does not exist. The app shows why.
- **Accessible.** Labelled fields, errors tied to their fields and announced, 44 px touch targets, keyboard-operable lists (add, move, remove), native dialogs, skip link, light by default with a remembered dark option.

## Sign-in

Cognito's hosted page (password, new-password step and authenticator-app set-up) with the authorization-code flow and PKCE ([src/lib/auth.ts](src/lib/auth.ts)). Tokens live in `sessionStorage`. Organizers are invited from the command line; see the runbook in [../infra/README.md](../infra/README.md). The app also shows a clear screen if a signed-in user is not in the `organizers` group (the API enforces this regardless).

## Configuration

One build runs anywhere. It reads `/config.json` at start-up:

```json
{ "apiUrl": "https://....execute-api.ap-south-1.amazonaws.com",
  "siteUrl": "https://example.org",
  "cognito": { "domain": "https://awsug-....auth.ap-south-1.amazoncognito.com", "clientId": "..." } }
```

The CDK **AdminApp** stack writes this file from its own outputs when it deploys. In `npm run dev`, Vite answers `/config.json` itself with the mock API and `devAuth: true`; it is not part of `dist/`.

## Layout

| Path | What |
|---|---|
| `src/lib/` | API client, auth (PKCE), IST handling, validation messages, path helpers, collection metadata |
| `src/form/` | Field components: text, markdown with preview, dates, selects, repeating groups (fold up when long), `pickers.tsx` (search-and-pick people with "add new" pop-up), `photos.tsx` (single photo, cover photo, bulk photo manager) |
| `src/state/` | App context, and `publish.tsx`: the shared "what is waiting, is a build running" state behind the Publish button |
| `src/ui/` | Shell (left menu with the chapter badge), Publish control, dialogs, icons (Tabler, imported as raw SVG), toasts |
| `src/pages/` | Dashboard, lists, the generic item editor, the event form (`editors/event-form.tsx`) and the other four (`editors/forms.tsx`), sign-in screens |
| `dev/mock-server.ts` | Local API: real handlers, in-memory S3, fake auth, photo "processing", timed builds |
| `test/` | Unit tests, and UI tests that drive the real app against the mock API |

## Limits

- **About, Code of Conduct, Privacy and site settings** are not editable here yet. They are Markdown files and one JSON file, not collections; edit them in the repo for now.
- **Photos:** JPEG, PNG, WebP, AVIF, GIF or TIFF, up to 25 MB. iPhone HEIC must be exported as JPEG first; the app says so.
- The JavaScript bundle is about 570 KB (190 KB compressed). Fine for five users; split it if the audience grows.
