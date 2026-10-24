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
| **Dashboard** | See what exists, items that need fixing, and drafts. **Publish** starts a site build and follows it (one at a time). |
| **Events, speakers, sponsors, organizers, blog posts** | List, create, edit, delete. Events have **Before the event** and **After the event** tabs covering every section of the event page. |
| **Photos** | Choose a file; it goes straight to S3 through a signed link, is resized and stripped of location data, and appears once processed. |
| **Drafts** | Events and posts have a Draft box. Drafts are saved but kept off the public site. |
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
| `src/form/` | Field components: text, markdown with preview, dates, selects, repeating groups, reference pickers, photo upload |
| `src/pages/` | Dashboard, lists, the generic item editor, the five forms (`editors/forms.tsx`), sign-in screens |
| `dev/mock-server.ts` | Local API: real handlers, in-memory S3, fake auth, photo "processing", timed builds |
| `test/` | Unit tests, and UI tests that drive the real app against the mock API |

## Limits

- **About, Code of Conduct, Privacy and site settings** are not editable here yet. They are Markdown files and one JSON file, not collections; edit them in the repo for now.
- **Photos:** JPEG, PNG, WebP, AVIF, GIF or TIFF, up to 25 MB. iPhone HEIC must be exported as JPEG first; the app says so.
- The JavaScript bundle is about 570 KB (190 KB compressed). Fine for five users; split it if the audience grows.
