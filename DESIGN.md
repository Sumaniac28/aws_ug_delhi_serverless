---
version: alpha
name: AWS User Group Delhi NCR
description: Community site for a volunteer AWS user group. Ink and paper with one marigold signal line, a Delhi Metro map motif, light by default with an opt-in dark theme.
colors:
  paper: "#fbfaf7"
  paper-card: "#ffffff"
  paper-muted: "#f1efe8"
  ink-900: "#0d1b2f"
  ink-950: "#081221"
  ink-600: "#445671"
  primary: "#fa8927"
  marigold-700: "#b24710"
  marigold-400: "#fead4c"
  line-muted: "#b8b4a6"
  track-blue: "#2f6bb3"
  track-green: "#2c8a5b"
  track-violet: "#6d4fb0"
  track-magenta: "#b0397f"
  dark-background: "#0d1b2f"
  dark-card: "#132338"
  dark-text: "#e4e9f1"
  dark-muted-text: "#a7b3c6"
typography:
  display-xl:
    fontFamily: Anek Latin
    fontSize: 4.5rem
    fontWeight: 760
    lineHeight: 1
    letterSpacing: -0.01em
  display-l:
    fontFamily: Anek Latin
    fontSize: 3rem
    fontWeight: 760
    lineHeight: 1.05
  h2:
    fontFamily: Anek Latin
    fontSize: 2rem
    fontWeight: 760
    lineHeight: 1.1
  h3:
    fontFamily: Anek Latin
    fontSize: 1.35rem
    fontWeight: 700
    lineHeight: 1.15
  body:
    fontFamily: Atkinson Hyperlegible Next
    fontSize: 1.0625rem
    fontWeight: 400
    lineHeight: 1.6
  body-s:
    fontFamily: Atkinson Hyperlegible Next
    fontSize: 0.9375rem
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: Atkinson Hyperlegible Next
    fontSize: 0.875rem
    fontWeight: 700
    lineHeight: 1.2
  mono:
    fontFamily: Atkinson Hyperlegible Mono
    fontSize: 0.9375rem
    fontWeight: 500
    lineHeight: 1.4
rounded:
  none: 0px
  sm: 4px
  md: 6px
  pill: 999px
spacing:
  1: 4px
  2: 8px
  3: 12px
  4: 16px
  6: 24px
  8: 32px
  12: 48px
  16: 64px
  24: 96px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.ink-950}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: 12px
  button-secondary:
    backgroundColor: "{colors.paper-card}"
    textColor: "{colors.ink-900}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: 12px
  link:
    textColor: "{colors.marigold-700}"
    typography: "{typography.body}"
  body-text:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-900}"
    typography: "{typography.body}"
  muted-text:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-600}"
    typography: "{typography.body-s}"
  dark-body-text:
    backgroundColor: "{colors.dark-background}"
    textColor: "{colors.dark-text}"
    typography: "{typography.body}"
  dark-muted-text:
    backgroundColor: "{colors.dark-background}"
    textColor: "{colors.dark-muted-text}"
    typography: "{typography.body-s}"
  surface-muted:
    backgroundColor: "{colors.paper-muted}"
    textColor: "{colors.ink-900}"
    typography: "{typography.body}"
  metro-line-past:
    backgroundColor: "{colors.line-muted}"
    height: 4px
  metro-line-upcoming:
    backgroundColor: "{colors.primary}"
    height: 4px
  track-line-blue:
    backgroundColor: "{colors.track-blue}"
    height: 4px
  track-line-green:
    backgroundColor: "{colors.track-green}"
    height: 4px
  track-line-violet:
    backgroundColor: "{colors.track-violet}"
    height: 4px
  track-line-magenta:
    backgroundColor: "{colors.track-magenta}"
    height: 4px
  dark-card:
    backgroundColor: "{colors.dark-card}"
    textColor: "{colors.dark-text}"
    typography: "{typography.body}"
  dark-link:
    backgroundColor: "{colors.dark-background}"
    textColor: "{colors.marigold-400}"
    typography: "{typography.body}"
---

## Overview

AWS User Group Delhi NCR is a volunteer-run community of people who build on AWS in Delhi, Gurugram and Noida. The site's job is to get a visitor to the next event and to show that this community has been showing up for years.

**Three principles**

1. **The line is the story.** Events are stations on a Delhi Metro-style line. The map metaphor appears in exactly four places (home, the agenda, the past-events archive, the footer plus 404). Everywhere else the site is plain and editorial.
2. **Type does the hierarchy.** A condensed Anek Latin headline, at least three times the body size, on a calm paper background. Boxes, shadows and icons do not make hierarchy.
3. **One signal colour, used rarely.** Marigold marks the one thing that matters on a screen: the primary action, the line, the next stop. It covers about 5% of any view.

**Atmosphere words:** platform signage, timetable, paper, ink, clear, civic, warm.

**Not this:** a SaaS landing page, a template, an AWS-branded property. See "Do's and Don'ts" and "Brand and trademark".

## Colors

Light is the default. Dark applies only when `<html class="dark">` is set by the visitor's toggle, and the OS colour-scheme setting is ignored on purpose. All tokens live in `src/styles/tokens.css`; names follow shadcn/Starwind (`--background --foreground --card --muted --muted-foreground --primary --primary-foreground --primary-accent --border --input --outline`) plus `--line --line-muted --track-1..4 --ink*`.

| Role | Light | Dark |
|---|---|---|
| Page background | paper `#fbfaf7` | ink-900 `#0d1b2f` |
| Card / raised | `#ffffff` | `#132338` |
| Muted surface | `#f1efe8` | `#192941` |
| Text | ink-900 `#0d1b2f` | `#e4e9f1` |
| Secondary text | ink-600 `#445671` | `#a7b3c6` |
| Primary fill (button, line, next stop) | marigold-500 `#fa8927` with ink-950 text | same |
| Orange text and links | marigold-700 `#b24710` | marigold-400 `#fead4c` |
| Hairlines | `#dad6ca` | `#25374f` |
| Input and outline-button borders | `#6b7a90` | `#70829e` |
| Focus ring | `#b24710` | `#fead4c` |
| Footer / map surface | `#0d1b2f` (fixed) | `#081221` |

**Track lines** (agenda only; 3 to 4 px strokes and station dots, never backgrounds): blue `#2f6bb3`, green `#2c8a5b`, violet `#6d4fb0`, magenta `#b0397f`; lighter variants in dark.

**Rules**

- Marigold-500 is a fill. It carries ink-950 text (7.75:1). Never white text on marigold, and never marigold-500 as text on paper (about 2.1:1, fails).
- Orange text on light surfaces is marigold-700 only.
- One primary button per view. Everything else is a secondary or a text link.
- Status colours (info, success, warning, error) appear only in badges and callouts.
- The hues are deliberately away from AWS: the ink is deeper and bluer than Squid Ink, and the orange is redder and darker than `#FF9900`.

**Verified contrast.** `npm run design:contrast` reads the hex values from `tokens.css` and checks about 26 pairs per theme against WCAG 2.2 AA (4.5:1 text, 3:1 UI and lines). It must pass before any release.

## Typography

Self-hosted variable fonts from Fontsource, all under the SIL Open Font License.

- **Display: Anek Latin** (Ek Type, Mumbai). Headlines use `font-stretch: 82%` and weight 760. Left-aligned, never centred, balanced wrapping.
- **Body and UI: Atkinson Hyperlegible Next** (Braille Institute). 17px, line height 1.6, measure no wider than 68ch.
- **Mono: Atkinson Hyperlegible Mono** for times, codes and the dates in the timetable.
- Hindi text, when it arrives, uses Anek Devanagari.

| Token | Size | Weight | Use |
|---|---|---|---|
| display-xl | 4.5rem (72px) | 760 | Home hero only |
| display-l | 3rem | 760 | Page titles, event titles |
| h2 | 2rem | 760 | Section titles |
| h3 | 1.35rem | 700 | Card and row titles |
| body | 1.0625rem | 400 | Running text |
| body-s | 0.9375rem | 400 | Meta, captions |
| label | 0.875rem | 700 | Buttons, badges |
| mono | 0.9375rem | 500 | Times, station codes |

The jump from body to the page headline is at least 3x. Never use Inter, Roboto, Arial or Poppins. Never use Amazon Ember or a lookalike.

## Layout

- 12-column grid, container 72rem, 1rem side gutters on phones.
- **Asymmetry on purpose:** the home hero and the event header split 7 / 5 (headline and facts on the left, the station panel on the right). The next event is large; past events are a plain list.
- Spacing scale in 4px steps (see front matter). Sections are separated by 4 to 6rem of space, not by boxes.
- Breakpoints: 640, 768, 1024, 1280. The metro line runs vertically below 768 and horizontally from 768 up.
- Tap targets are at least 44 by 44px on touch.

## Elevation & Depth

Flat. Surfaces are separated by a 1px hairline (`--border`) or a change of background, not by shadows. No glassmorphism, no glow, no gradient washes. The one exception is the sticky header, which gets a hairline on scroll.

## Shapes

Small radius (`--radius` 6px) on buttons and inputs. Pills only for badges. Cards have a 6px radius and a hairline. The only circles on the site are metro stations and avatars; the only hexagon is the chapter badge. Station geometry: a 14px ring with a 3px stroke for an ordinary stop, a 22px ring with a filled centre for the interchange ("next stop").

## Components

- **Button.** Starwind button, restyled: primary is marigold with ink text; secondary is a hairline outline; ghost is text. Minimum height 44px. Focus ring is `--outline`. One primary button per view.
- **Header.** Sticky, solid paper with a hairline. Badge and name left; nav with a marigold station tick under the current page; one primary "Join us" button. Under 1024px a no-JavaScript `<details>` menu replaces the nav, and carries Sponsors and Contact.
- **Footer.** Two zones and a quiet bar on the fixed ink surface, with no call-to-action block (that rule is deliberate: a big invitation above a link list reads as an advert before a directory). Left: the badge and name, the one-line tagline, the small three-city map (Delhi the interchange; schematic, not geographic), social icon buttons and the contact email. Right: three short link groups (Meet us, Learn more, Get involved) with marigold headings and muted links that brighten on hover. Bottom: copyright, Code of Conduct, Privacy, and the "not an official AWS website" disclaimer. The metro motif appears once, as a thin marigold line along the top with its first station. Rules: no more than three link groups, never four equal columns; hierarchy by size and tone, not decoration; no per-link icons or dots.
- **PageHeader.** Every list and landing page opens the same way: breadcrumb, h1, marigold rule, lede, optional meta row (counts) and actions.
- **EventCard.** The image-led card: 3:2 cover, ticket-style date (month, day, year), series and place pills, title as the one link (whole card clickable), two-line summary, the faces of who spoke and "N speakers". A status badge shows only when the event is not simply past. The `feature` size lays it out wide.
- **EventLine.** Events as stations on the line, for archives and lists: each stop is a whole-row link with a thumbnail, series and place pills and a speaker count. No "Past" badge on every row.
- **PersonCard.** One card for speakers and the team: square photo (initials when there is none or no consent), name, one line, a 44px LinkedIn button. **Speakers never show a job title or company** (they change); their line is "Spoke at 3 events", built from their appearances. **No claim of a start year or a "first" anywhere**: the group is older than the records on this site, so such claims would mislead. Team members show their community role.
- **Pill.** Icon plus text, never colour alone. **AvatarStack.** Overlapping faces with "+N"; names are read once as text.
- **Section navigation.** A sticky anchor bar on long pages (events); the section in view gets the tick. Plain links without JavaScript.
- **Stat strip.** Large condensed numerals with small labels, counting up once. Only real numbers from content; on an ink band for emphasis.
- **Partner tile.** Logo on a white chip, name, a line about what the partner does, "Supported N events". Larger tiles for title and gold tiers. Logos are trimmed of margins, and every chip is the same size with the logo contained in it by a fixed pixel max-height (a percentage max-height does not resolve inside an auto-height grid), so wide wordmarks and square badges sit alike. The Sponsors page also carries the Community Day packages and the deck download.
- **Next-stop panel.** One large block for the soonest upcoming event: station ring, date, title, venue, countdown, the primary button. With no upcoming event the same place shows an ink board, "Next stop: being planned".
- **Metro line.** Vertical list of stations on a 4px line. Marigold for upcoming, `--line-muted` for the past. Each station: ring, date (mono), title link.
- **Agenda.** One line per track, coloured; each session is a station with its time and speakers. A single-track event is one line.
- **Photos.** A bento grid (first photo large, "+N more" on the last tile) opening a viewer; a ribbon on lists. Informative alt text on every photo.
- **Badge.** Pill, hairline or soft fill, sentence case. Status: Upcoming, Today, Past, Cancelled, Postponed.
- **Theme toggle.** Icon button in the header; two states; shows the sun in light and the moon in dark.
- **Icons.** Tabler outline icons, inlined at build time by `Icon.astro`, always decorative (the text beside them carries the meaning).

### One layout for every event

The event page and the admin form are the same for every event, whatever its type, size, mode or date. The page always shows Overview, Venue, Speakers, Agenda, Partners, Recap and Photos, in that order, each with a designed empty state worded for before or after the event; extras (numbers, hosts, what to bring, FAQs, links, Community Day extras, quotes, resources, posts) follow only when the event has them. The form always shows the same sections, so organizers never have to wonder where a field went. Fields that do not apply (venue for an online event, Community Day extras for a small one) are left empty.

### Empty states

Nothing is ever a bare box. An empty state (`EmptyState.astro`) has a small metro illustration, a short sentence-case title, one or two plain sentences, one primary action that starts with a verb, and an optional secondary link. It tells the visitor what is going on and what they can do next, and where it helps it shows something real underneath (for example "Recently on the line" under "No upcoming events"). Copy to follow: "The next stop is being planned.", "No stories yet.", "Photos from this event are coming.", "Be our first partner." A section with nothing to say is hidden rather than apologising; never write "No bio available".

## Do's and Don'ts

| Never | Instead |
|---|---|
| Gradient hero, glowing blobs, decorative circles | Flat paper, one headline, the station panel |
| A grid of identical shadowed cards | Vary size by importance; a list for the past |
| All-caps eyebrow labels, "01 / 02 / 03" markers | Plain sentence-case headings |
| An icon above every heading | Words first; icons only where they are controls |
| Stat banners in the hero | Put real numbers inside each past event page |
| Centred everything | Left-aligned text on the grid |
| Emoji as icons, glassmorphism, bounce easing | Lucide or Tabler line icons; ease-out 150ms |
| Marigold text on paper, white text on marigold | Marigold-700 text; ink on marigold fills |
| Stock photography | Real meetup photos with alt text, or flat placeholders until they exist |
| Amazon Ember, the AWS smile, AWS service icons as decoration, the `#232F3E` + `#FF9900` pairing | The chapter's Delhi skyline badge, Anek + Atkinson, the Yamuna ink and marigold palette |
| Bounce, parallax, scroll-jacking, smooth-scroll libraries, glow, motion that cannot be stopped | The twelve patterns in Motion, with one easing curve and a pause on every loop |

## Motion

Motion tells the metro story: lines draw, stations arrive, the board counts down. It never decorates for its own sake. Styles are in `src/styles/motion.css`; behaviour is in `src/scripts/motion.ts` and `public/scripts/page-transitions.js`.

**Tokens.** One curve, `--ease-out` (`cubic-bezier(0.2, 0.7, 0.2, 1)`), and three durations: micro `--dur-micro` 150ms (hover, press), reveal `--dur-reveal` 450ms, draw `--dur-draw` 800ms (lines). Loops run at a steady reading speed of about 40px a second.

| # | Pattern | Where |
|---|---|---|
| 1 | Partner logo marquee | Home, top of Sponsors |
| 2 | Photo ribbon | Home, Past events |
| 3 | Countdown board (in-coach LED "next station" style) | Next stop panel, upcoming event header |
| 4 | Count-up numbers | Event "By the numbers", home "The line so far" |
| 5 | Card-to-page transition (title and picture travel) | Event and speaker links into their pages, and back |
| 6 | The metro line draws itself | Next stops, Past events, agenda tracks, footer map |
| 7 | Next-station pulse, three times | The interchange ring of the next event |
| 8 | Scroll reveal, a 12px rise, once | Sections, grids and lists |
| 9 | Hover and focus responses | Rows (the station fills), photos and chips lift 2px, buttons press |
| 10 | Gallery viewer | Event photos |
| 11 | Theme cross-fade | Theme toggle |
| 12 | Arrival sequence | Home hero; the 404 train pulling in |

**Rules.**
- Everything moves only under `prefers-reduced-motion: no-preference`. With reduced motion the page is complete and still: marquees become a wrapped row or a swipeable strip, numbers show their value, nothing reveals.
- Anything that loops or updates on its own has a visible Pause button (`aria-pressed`, fixed name), also pauses on hover and keyboard focus, and stops while off-screen (WCAG 2.2.2). One-shot motion stays under five seconds.
- Nothing is hidden unless JavaScript has run and marked what is already on screen; without JavaScript every word is visible. Numbers and the countdown keep their real value in the HTML for screen readers.
- Strict CSP: no inline `style=""`, no new inline scripts. Content-dependent values are set through the CSSOM.
- Duplicated marquee tracks are `aria-hidden` and `inert`; only the first is read or tabbed to.

## Motif rules

The metro motif is used in four places only: the home "Next stops", each event's agenda, the past-events archive, and the footer map (plus the 404 "Wrong platform"). It is built from inline SVG and tokens, so it themes itself. It must be readable without colour (stations have labels; tracks have names).

## Imagery

Real photographs of real meetups: crowds and candid moments, not staged. No attendee tagging, no identifiable minors. Every image has descriptive alt text, or an empty alt when it is decorative. Posters are flat colour with the line motif until real ones exist. Photos get no filter; in dark mode they are shown at 92% brightness.

## Voice & tone

Plain, specific, a little dry. Say the venue, the date and the time. Prefer "Register on Konfhub" to "Get your tickets now!". Examples: "Next stop: Meetup #13, Saturday 14 November, Gurugram." "Wrong platform. That page isn't on this line." Avoid hype words and exclamation marks.

## Accessibility

- WCAG 2.2 AA is the floor in both themes (checked by `npm run design:contrast`).
- Focus ring is 3px, offset 3px, in `--outline`; it is never removed.
- Respect `prefers-reduced-motion` and give every loop a pause (see Motion).
- The theme toggle is a real button with `aria-pressed` and a fixed label, "Dark theme".
- Colour is never the only signal: tracks and statuses always carry text.
- Skip link first in the document; landmarks on every page; `lang="en-IN"`.

## Brand and trademark

The group's name is permitted by the AWS user group programme, but written confirmation from the programme is still pending (ADR-002). Until then:

- No AWS smile as the site's mark, no AWS service icons as decoration, no Amazon Ember. The **official AWS logo may appear, unaltered and on a white chip, only in partner and sponsor lists** (the group is allowed to credit AWS as a partner). It is never the site mark, never a decoration and never recoloured.
- The mark is the chapter's Delhi skyline hexagon (gold outline, navy field), taken from the group's own logo without its "aws" wordmark (`npm run brand:badge`). It sits beside the name set in Anek; never show it with the AWS smile until the programme confirms in writing.
- The footer always says the group is community-run, that this is not an official AWS website, and that AWS is a trademark of Amazon.com, Inc. or its affiliates.
- Domain: nothing containing "aws" until the trademark query is answered.

## Agent prompt guide

When generating or changing UI for this site:

1. Use only the tokens in `src/styles/tokens.css` through Tailwind classes (`bg-background`, `text-foreground`, `text-primary-accent`, `bg-primary`, `border-border`, `text-muted-foreground`). Never write a raw hex colour in a component.
2. Headings are Anek Latin via the global `h1 h2 h3` rule. Do not set another heading font.
3. Do not add shadows, gradients, glass, or rounded-2xl cards. Use hairlines.
4. Follow the Do's and Don'ts table above before adding any decorative element.
5. Run `npm run check`, `npm run build`, `npm run design:contrast`, and look at the page in both themes.

## Known gaps

- No real photography yet (content migration, Phase 8).
- The badge is a raster cut from the old logo (510x586); a vector redraw would be sharper at large sizes.
- The Hindi (Anek Devanagari) rules are untested.
- AWS confirmation of naming and domain is outstanding.
