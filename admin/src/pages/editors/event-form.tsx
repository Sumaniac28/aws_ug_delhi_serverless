import { useEffect, useState } from 'react';
import { EVENT_STATUSES, MODES, REGISTRATION_STATES, SERIES, SIZES, SPONSOR_TIERS } from '../../../../src/schema/index.ts';
import { useForm } from '../../form/context.tsx';
import { CheckField, DateTimeField, Disclosure, InlineSwitch, MarkdownField, MediaField, NumberField, RepeatField, Section, SelectField, StarField, StringListField, TextArea, TextField } from '../../form/fields.tsx';
import { CoverPhotoField, PhotoManager, Thumb } from '../../form/photos.tsx';
import { EntityPicker, SponsorSelect } from '../../form/pickers.tsx';
import { formatIst, formatIstDay, phaseOf } from '../../lib/ist.ts';
import { append, getIn, setIn } from '../../lib/path.ts';
import { detectPlatform } from '../../lib/platform.ts';
import { useRefOptions } from '../../state/hooks.ts';
import { Icon } from '../../ui/icons.tsx';
import { Button } from '../../ui/primitives.tsx';

const opts = (values: readonly string[], labels: Record<string, string> = {}) => values.map((v) => ({ value: v, label: labels[v] ?? v.charAt(0).toUpperCase() + v.slice(1).replace(/-/g, ' ') }));

const SERIES_OPTS = opts(SERIES, { 'online-session': 'Online session', 'community-day': 'Community Day' });
const SIZE_OPTS = opts(SIZES, { small: 'Small (online, or 20 to 50 people)', mid: 'Mid-size (50 to 150)', large: 'Large (200 or more)' });
const MODE_OPTS = opts(MODES, { offline: 'In person', online: 'Online', hybrid: 'Hybrid (in person and online)' });
const STATUS_OPTS = opts(EVENT_STATUSES);
const REG_OPTS = opts(REGISTRATION_STATES, { 'not-open': 'Not open yet', open: 'Open', closed: 'Closed' });
const TIER_OPTS = opts(SPONSOR_TIERS, { title: 'Title sponsor', venue: 'Venue partner', community: 'Community partner' });
const PLATFORM_OPTS = [
  { value: 'konfhub', label: 'Konfhub' },
  { value: 'meetup', label: 'Meetup' },
  { value: 'luma', label: 'Luma' },
  { value: 'other', label: 'Other' },
];
const POST_KIND_OPTS = [
  { value: 'blog', label: 'Blog post' },
  { value: 'linkedin', label: 'LinkedIn post' },
  { value: 'instagram', label: 'Instagram post' },
  { value: 'writeup', label: 'Attendee write-up' },
];

/** The parts of the document that belong to the time after the event. */
const AFTER_PATHS = ['recap', 'gallery', 'albumUrl', 'feedbackHighlights', 'feedbackSummary', 'resources', 'posts', 'stats'];
const PHOTO_PATHS = ['gallery', 'albumUrl'];
const RESULT_PATHS = ['recap', 'feedbackHighlights', 'feedbackSummary', 'resources', 'posts', 'stats'];

const filled = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : v && typeof v === 'object' ? Object.values(v).some(filled) : v !== undefined && v !== null && v !== '');

interface StepDef {
  id: string;
  title: string;
  /** Parts of the document this step edits, for counting its problems. */
  paths: string[];
  needed?: boolean;
  done: (doc: Record<string, any>) => boolean;
}

const STEPS: Record<string, StepDef> = {
  basics: { id: 'basics', title: 'The basics', paths: ['title', 'summary', 'series', 'size', 'mode'], needed: true, done: (d) => !!(d.title && d.summary && d.series && d.size && d.mode) },
  when: { id: 'when', title: 'When and where', paths: ['start', 'end', 'status', 'previousStart', 'venue'], needed: true, done: (d) => !!(d.start && d.end && (d.mode === 'online' || d.venue?.name)) },
  cover: { id: 'cover', title: 'Cover photo', paths: ['poster', 'ogImage'], done: (d) => !!d.poster },
  register: { id: 'register', title: 'Registration', paths: ['registration', 'registrationValidFrom', 'registrationLinks', 'tickets', 'linkedinUrl'], done: (d) => (d.registrationLinks?.length ?? 0) > 0 },
  people: { id: 'people', title: 'Speakers and agenda', paths: ['speakers', 'hosts', 'tracks', 'agenda'], done: (d) => (d.speakers?.length ?? 0) > 0 },
  partners: { id: 'partners', title: 'Partners', paths: ['sponsors'], done: (d) => (d.sponsors?.length ?? 0) > 0 },
  about: { id: 'about', title: 'Description and extras', paths: ['overview', 'whatToBring', 'faqs', 'largeExtras'], needed: true, done: (d) => !!d.overview },
  after: { id: 'after', title: 'After the event', paths: AFTER_PATHS, done: () => false },
  photos: { id: 'photos', title: 'Event photos', paths: PHOTO_PATHS, done: (d) => (d.gallery?.length ?? 0) > 0 },
  results: { id: 'results', title: 'Recap and results', paths: RESULT_PATHS, done: (d) => !!(d.recap || filled(d.stats)) },
};

/** Which step is on screen, for the list on the left. */
function useActiveStep(ids: string[]): string | undefined {
  const [active, setActive] = useState<string | undefined>(ids[0]);
  const key = ids.join('|');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const seen = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.step!;
          if (e.isIntersecting) seen.add(id);
          else seen.delete(id);
        }
        const first = ids.find((id) => seen.has(id));
        if (first) setActive(first);
      },
      { rootMargin: '-10% 0px -60% 0px' },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return active;
}

function StepList({ steps, active }: { steps: (StepDef & { errors: number; isDone: boolean })[]; active?: string }) {
  return (
    <nav aria-label="Event steps">
      <ol className="relative flex gap-2 overflow-x-auto pb-1 lg:grid lg:gap-1 lg:overflow-visible lg:pb-0">
        {steps.map((s, i) => (
          <li key={s.id} className="shrink-0">
            <a
              href={`#${s.id}`}
              aria-current={active === s.id ? 'step' : undefined}
              className={`flex min-h-ctl items-center gap-3 rounded-md border-l-4 px-2 pr-3 no-underline hover:bg-muted ${active === s.id ? 'border-primary bg-muted font-bold' : 'border-transparent'}`}
            >
              <span
                aria-hidden="true"
                className={`grid size-7 shrink-0 place-items-center rounded-full text-sm font-bold ${s.errors > 0 ? 'bg-error text-error-foreground' : s.isDone ? 'bg-primary text-primary-foreground' : 'border border-input text-muted-foreground'}`}
              >
                {s.errors > 0 ? s.errors : s.isDone ? <Icon name="check" size={16} /> : i + 1}
              </span>
              <span>
                {s.title}{' '}
                {s.errors > 0 && <span className="visually-hidden">({s.errors} to fix)</span>}
                {s.isDone && s.errors === 0 && <span className="visually-hidden">(done)</span>}
                {!s.needed && !s.isDone && s.errors === 0 && <span className="hidden text-sm font-normal text-muted-foreground lg:block">Optional</span>}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** A small card, as the event will look in the list on the site, updating while you type. */
function EventPreview() {
  const form = useForm();
  const d = form.doc;
  const place = d.mode === 'online' ? 'Online' : d.venue?.locality;
  return (
    <div aria-label="How this event looks in the list on the website" role="group" className="hidden overflow-hidden rounded-lg border border-border bg-card lg:block">
      <p className="px-3 pt-3 text-sm font-bold text-muted-foreground">How it looks on the site</p>
      <div className="m-3 aspect-[3/2] overflow-hidden rounded-md bg-muted">
        {d.poster ? (
          <Thumb mediaKey={d.poster} alt="" className="size-full" />
        ) : (
          <div className="grid size-full place-items-center text-muted-foreground">
            <Icon name="photo-star" size={28} />
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 gap-1 px-3 pb-3">
        <p className="font-mono text-sm tracking-wide text-primary-accent">{formatIstDay(d.start) || 'DATE TO COME'}</p>
        <p className="font-display text-xl leading-tight font-bold [font-stretch:82%]">{d.title || 'Untitled event'}</p>
        {place && (
          <p className="flex items-center gap-1 text-muted-foreground">
            <Icon name="map-pin" size={16} />
            {place}
          </p>
        )}
      </div>
    </div>
  );
}

/** Turns pasted lines into quote cards. A line can end with " - Attendee, student" to say who said it. */
export function parseQuotes(text: string): { quote: string; attribution?: string }[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cut = Math.max(line.lastIndexOf(' — '), line.lastIndexOf(' – '), line.lastIndexOf(' - '));
      const quote = (cut > 0 ? line.slice(0, cut) : line).trim().replace(/^["“”']+|["“”']+$/g, '').trim();
      const attribution = cut > 0 ? line.slice(cut + 3).trim() : '';
      return attribution ? { quote, attribution } : { quote };
    })
    .filter((q) => q.quote);
}

function PasteQuotes() {
  const form = useForm();
  const [text, setText] = useState('');
  const quotes = parseQuotes(text);
  return (
    <div className="grid grid-cols-1 gap-2 rounded-lg border border-dashed border-input p-4">
      <label htmlFor="paste-quotes" className="text-sm font-semibold">
        Paste many quotes at once
      </label>
      <p className="text-[0.8125rem] text-muted-foreground">One quote per line. End a line with “ - Attendee, student” to say who said it.</p>
      <textarea id="paste-quotes" rows={4} value={text} onChange={(e) => setText(e.target.value)} className="block w-full rounded-md border border-input bg-background px-3 py-2" />
      <div>
        <Button
          disabled={quotes.length === 0}
          onClick={() => {
            form.update((d) => quotes.reduce((doc, q) => append(doc, 'feedbackHighlights', q), d));
            setText('');
          }}
        >
          {quotes.length > 1 ? `Add ${quotes.length} quotes` : 'Add quote'}
        </Button>
      </div>
    </div>
  );
}

export function EventForm() {
  const form = useForm();
  const speakers = useRefOptions('speakers');
  const organizers = useRefOptions('organizers');
  const sponsors = useRefOptions('sponsors');
  const [wantAfter, setWantAfter] = useState(false);

  const doc = form.doc as Record<string, any>;
  const isOnline = doc.mode === 'online';
  const platformIsOther = (p: string) => getIn(doc, `${p}.platform`) === 'other';
  const trackOptions = ((doc.tracks as { name?: string }[] | undefined) ?? []).filter((t) => t.name).map((t) => ({ value: t.name!, label: t.name! }));

  const ended = phaseOf(doc.start, doc.end) === 'past';
  const afterErrors = AFTER_PATHS.reduce((n, p) => n + form.errorsUnder(p).length, 0);
  const showAfter = ended || wantAfter || AFTER_PATHS.some((p) => filled(doc[p])) || afterErrors > 0;
  const hasExtras = filled(doc.largeExtras);

  const order = ['basics', 'when', 'cover', 'register', 'people', 'partners', 'about', ...(showAfter ? ['photos', 'results'] : ['after'])];
  const steps = order.map((id) => {
    const def = STEPS[id]!;
    return { ...def, errors: def.paths.reduce((n, p) => n + form.errorsUnder(p).length, 0), isDone: def.done(doc) };
  });
  const active = useActiveStep(order);
  const n = (id: string) => order.indexOf(id) + 1;

  const registrationLinkUrl = (p: string) => (
    <TextField
      path={`${p}.url`}
      label="Address"
      type="url"
      hint="Paste the link. We work out whether it is Meetup, Luma or Konfhub."
      onValue={(v) => {
        const found = detectPlatform(v);
        if (found) form.update((d) => (getIn(d, `${p}.platform`) === found ? d : setIn(d, `${p}.platform`, found)));
      }}
    />
  );

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start">
      <aside className="grid grid-cols-1 content-start gap-4 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-9rem)] lg:overflow-y-auto">
        <StepList steps={steps} active={active} />
        <EventPreview />
      </aside>

      <div className="grid grid-cols-1 gap-6">
        <Section id="basics" step={n('basics')} title="The basics" tag="Needed">
          <TextField path="title" label="Title" />
          <TextField path="summary" label="Short summary" hint="One or two sentences. Search engines show this under the title." counter={160} />
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <SelectField path="series" label="Type of event" options={SERIES_OPTS} />
            <SelectField path="size" label="Size" options={SIZE_OPTS} />
            <SelectField path="mode" label="Where" options={MODE_OPTS} />
          </div>
        </Section>

        <Section id="when" step={n('when')} title="When and where" tag="Needed" errorPrefix="venue">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <DateTimeField path="start" label="Starts" />
            <DateTimeField path="end" label="Ends" />
          </div>
          {doc.start && doc.end && Date.parse(doc.end) > Date.parse(doc.start) && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Icon name="clock" size={18} />
              {formatIst(doc.start)} to {formatIst(doc.end)} (India time)
            </p>
          )}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <SelectField path="status" label="Status" hint="Leave as “scheduled” unless the event is cancelled or moved." options={STATUS_OPTS} fallback="scheduled" />
            {doc.status === 'rescheduled' && <DateTimeField path="previousStart" label="It used to start" hint="The old start time, so the page can say it moved." />}
          </div>
          {isOnline ? (
            <div className="flex flex-wrap items-center gap-3 rounded-md bg-muted p-4">
              <Icon name="info-circle" />
              <p className="flex-1">This is an online event, so no venue is needed.</p>
              {doc.venue && <Button onClick={() => form.set('venue', undefined)}>Clear the saved venue</Button>}
            </div>
          ) : (
            <>
              <TextField path="venue.name" label="Venue name" />
              <TextField path="venue.streetAddress" label="Street address" />
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
                <TextField path="venue.locality" label="City or area" placeholder="Gurugram" />
                <TextField path="venue.region" label="State" placeholder="Haryana" />
                <TextField path="venue.postalCode" label="PIN code" />
              </div>
              <TextField path="venue.mapUrl" label="Map link" type="url" optional />
            </>
          )}
        </Section>

        <Section id="cover" step={n('cover')} title="Cover photo" tag="Optional" hint="The big picture at the top of the event page. Photos are resized and cleaned of location data automatically.">
          <CoverPhotoField path="poster" galleryPath="gallery" label="Cover photo" hint="Landscape works best, about 1600 pixels wide. Before the event, upload your own poster. Afterwards you can swap it for one of the event's photos." />
          <Disclosure title="Advanced: picture used when the page is shared" open={!!doc.ogImage}>
            <MediaField path="ogImage" label="Social sharing picture" hint="Shown when the page is shared on LinkedIn or WhatsApp. If empty, the cover photo is used." />
          </Disclosure>
        </Section>

        <Section id="register" step={n('register')} title="Registration" tag="Optional" hint="Tickets and RSVPs stay on Konfhub, Meetup or Luma. The site only links to them.">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <SelectField path="registration" label="Registration is" options={REG_OPTS} />
            {doc.registration === 'not-open' && <DateTimeField path="registrationValidFrom" label="Opens on" optional />}
          </div>
          <RepeatField
            path="registrationLinks"
            label="Registration links"
            itemLabel="Link"
            addLabel="Add a link"
            empty={() => ({ platform: 'konfhub', primary: !(doc.registrationLinks?.length > 0) })}
            hint="Mark exactly one as the main button while registration is open."
          >
            {(p) => (
              <>
                {registrationLinkUrl(p)}
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <SelectField path={`${p}.platform`} label="Where" options={PLATFORM_OPTS} />
                  {platformIsOther(p) && <TextField path={`${p}.label`} label="Name of the site" />}
                </div>
                <CheckField path={`${p}.primary`} label="This is the main registration button" />
              </>
            )}
          </RepeatField>
          <RepeatField
            path="tickets"
            label="Ticket types"
            itemLabel="Ticket"
            addLabel="Add a ticket type"
            empty={() => ({ price: 0, perks: [], soldOut: false })}
            summaryField="name"
            hint="Optional. For an event with more than one kind of ticket, such as Early bird and General. Tickets are still sold on Konfhub or Meetup: this shows what each one includes, and lets you mark one as sold out later."
            headerExtra={(p) => <InlineSwitch path={`${p}.soldOut`} label="Sold out" />}
          >
            {(p) => (
              <>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <TextField path={`${p}.name`} label="Ticket name" placeholder="Early bird" />
                  <NumberField path={`${p}.price`} label="Price in rupees" hint="0 means free." optional={false} />
                </div>
                <TextField path={`${p}.note`} label="Short note" optional placeholder="First 50 seats" />
                <StringListField path={`${p}.perks`} label="What it includes" addLabel="Add a perk" placeholder="Event T-shirt" />
                <TextField path={`${p}.url`} label="Link for this ticket" type="url" optional hint="Leave empty to use the main registration link." />
                <CheckField path={`${p}.featured`} label="Show as most popular" hint="Only one ticket can be most popular." />
              </>
            )}
          </RepeatField>
          <TextField path="linkedinUrl" label="LinkedIn event link" type="url" optional />
        </Section>

        <Section id="people" step={n('people')} title="Speakers and agenda" tag="Optional" hint="Pick people who are already added, or add a new one without leaving this page.">
          <EntityPicker path="speakers" label="Speakers" collection="speakers" options={speakers.items} reload={speakers.reload} loading={speakers.loading} />
          <EntityPicker path="hosts" label="Hosts and volunteers" collection="organizers" options={organizers.items} reload={organizers.reload} loading={organizers.loading} />
          <RepeatField path="agenda" label="Sessions" itemLabel="Session" addLabel="Add a session" empty={() => ({})} summaryField="title" hint="Optional. The day's schedule, in order.">
            {(p) => (
              <>
                <TextField path={`${p}.title`} label="Session title" />
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <DateTimeField path={`${p}.start`} label="Starts" />
                  <DateTimeField path={`${p}.end`} label="Ends" />
                </div>
                {trackOptions.length > 0 && <SelectField path={`${p}.track`} label="Track" optional options={trackOptions} />}
                <EntityPicker path={`${p}.speakers`} label="Speakers" collection="speakers" options={speakers.items} reload={speakers.reload} loading={speakers.loading} compact />
              </>
            )}
          </RepeatField>
          <Disclosure title="Tracks, for events with parallel sessions" open={filled(doc.tracks)}>
            <RepeatField path="tracks" label="Tracks" itemLabel="Track" addLabel="Add a track" empty={() => ({})} hint="Add tracks first, then give each session a track.">
              {(p) => <TextField path={`${p}.name`} label="Track name" placeholder="Serverless" />}
            </RepeatField>
          </Disclosure>
        </Section>

        <Section id="partners" step={n('partners')} title="Partners" tag="Optional" hint="Sponsors and venue hosts for this event.">
          <RepeatField path="sponsors" label="Sponsors" itemLabel="Sponsor" addLabel="Add a sponsor" empty={() => ({ tier: 'community' })}>
            {(p) => (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <SponsorSelect path={`${p}.sponsor`} label="Sponsor" options={sponsors.items} reload={sponsors.reload} />
                <SelectField path={`${p}.tier`} label="How they are listed" options={TIER_OPTS} />
              </div>
            )}
          </RepeatField>
        </Section>

        <Section id="about" step={n('about')} title="Description and extras" tag="Needed" hint="What it is about, who it is for, and the level.">
          <MarkdownField path="overview" label="Overview" />
          <StringListField path="whatToBring" label="What to bring" addLabel="Add an item" placeholder="Laptop and charger" />
          <RepeatField path="faqs" label="Questions and answers" itemLabel="Question" addLabel="Add a question" empty={() => ({})} summaryField="q">
            {(p) => (
              <>
                <TextField path={`${p}.q`} label="Question" />
                <TextArea path={`${p}.a`} label="Answer" rows={3} />
              </>
            )}
          </RepeatField>
          <Disclosure title="Community Day extras" hint="Call for speakers, sponsorship brief and directions. For large events." open={hasExtras}>
            {doc.size === 'large' || hasExtras ? (
              <>
                <TextField path="largeExtras.cfpUrl" label="Call for speakers link" type="url" optional />
                <DateTimeField path="largeExtras.cfpCloses" label="Call for speakers closes" optional />
                <TextField path="largeExtras.sponsorshipPdf" label="Sponsorship brief (PDF link)" type="url" optional />
                <TextArea path="largeExtras.directions" label="Getting there" optional rows={3} />
              </>
            ) : (
              <p className="text-muted-foreground">These only apply to large events. Set Size to “Large” in The basics to fill them in.</p>
            )}
          </Disclosure>
        </Section>

        {showAfter ? (
          <>
            <Section id="photos" step={n('photos')} title="Event photos" tag="After the event" hint="Add the photos from the day. You can pick many at once. The cover photo can be any of them.">
              <PhotoManager path="gallery" coverPath="poster" defaultAlt={`Photo from ${doc.title ?? 'the event'}`} />
              <TextField path="albumUrl" label="Full album link" type="url" optional hint="Google Photos or Drive, for the photos that do not fit here." />
            </Section>

            <Section id="results" step={n('results')} title="Recap and results" tag="After the event">
              <MarkdownField path="recap" label="Recap" optional rows={8} hint="A short write-up for people who missed it. It appears once the event is over." />
              <div className="grid grid-cols-1 gap-3">
                <h3 className="text-base">Feedback numbers</h3>
                <p className="text-[0.8125rem] text-muted-foreground">From the feedback form. They appear above the quotes. Fill in only what you know.</p>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
                  <NumberField path="feedbackSummary.responses" label="Responses" />
                  <NumberField path="feedbackSummary.averageRating" label="Average rating" hint="Out of 5, for example 4.6." step={0.1} min={1} max={5} />
                  <NumberField path="feedbackSummary.recommendPercent" label="Would recommend (%)" max={100} />
                </div>
              </div>
              <RepeatField path="feedbackHighlights" label="What attendees said" itemLabel="Quote" addLabel="Add a quote" empty={() => ({})} summaryField="quote" hint="Typed in from the feedback. Use roles, not names (for example “Attendee, student”).">
                {(p) => (
                  <>
                    <TextArea path={`${p}.quote`} label="Quote" rows={2} />
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <TextField path={`${p}.attribution`} label="Who said it" optional placeholder="Attendee, backend developer" />
                      <StarField path={`${p}.rating`} label="Rating" />
                    </div>
                    <CheckField path={`${p}.featured`} label="Show this quote large on the event page" />
                  </>
                )}
              </RepeatField>
              <PasteQuotes />
              <RepeatField path="resources" label="Slides and resources" itemLabel="Talk" addLabel="Add a talk" empty={() => ({})} summaryField="talk">
                {(p) => (
                  <>
                    <TextField path={`${p}.talk`} label="Talk title" />
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <TextField path={`${p}.slidesUrl`} label="Slides link" type="url" optional />
                      <TextField path={`${p}.repoUrl`} label="Code link" type="url" optional />
                    </div>
                  </>
                )}
              </RepeatField>
              <RepeatField path="posts" label="Posts and write-ups" itemLabel="Link" addLabel="Add a link" empty={() => ({ kind: 'blog' })}>
                {(p) => (
                  <>
                    <SelectField path={`${p}.kind`} label="What it is" options={POST_KIND_OPTS} />
                    <TextField path={`${p}.title`} label="Title" />
                    <TextField path={`${p}.url`} label="Address" type="url" />
                  </>
                )}
              </RepeatField>
              <div className="grid grid-cols-1 gap-3">
                <h3 className="text-base">By the numbers</h3>
                <p className="text-muted-foreground">Shown on the event page after it is over.</p>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
                  <NumberField path="stats.attendees" label="Attendees" />
                  <NumberField path="stats.sessions" label="Sessions" />
                  <NumberField path="stats.speakers" label="Speakers" />
                </div>
              </div>
            </Section>
          </>
        ) : (
          <Section id="after" step={n('after')} title="After the event" tag="Later" hint="Come back once the event is over to add the photos, a recap, attendee quotes and the numbers.">
            <div>
              <Button onClick={() => setWantAfter(true)}>
                <Icon name="photo-plus" size={18} />
                Fill these in now
              </Button>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
