import { useState } from 'react';
import { EVENT_STATUSES, MODES, REGISTRATION_STATES, SERIES, SIZES, SPONSOR_TIERS } from '../../../../src/schema/index.ts';
import { CheckField, DateTimeField, MarkdownField, MediaField, NumberField, RefPicker, RefSelect, RepeatField, Section, SelectField, StringListField, TextArea, TextField } from '../../form/fields.tsx';
import { useForm } from '../../form/context.tsx';
import { getIn } from '../../lib/path.ts';
import { useRefOptions } from '../../state/hooks.ts';

const opts = (values: readonly string[], labels: Record<string, string> = {}) => values.map((v) => ({ value: v, label: labels[v] ?? v.charAt(0).toUpperCase() + v.slice(1).replace(/-/g, ' ') }));

// ===================================================================================================
// Events
// ===================================================================================================

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
const RATING_OPTS = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} out of 5` }));

const AFTER_PATHS = ['recap', 'gallery', 'albumUrl', 'feedbackHighlights', 'resources', 'posts', 'stats'];

export function EventForm() {
  const form = useForm();
  const [tab, setTab] = useState<'before' | 'after'>('before');
  const speakers = useRefOptions('speakers');
  const organizers = useRefOptions('organizers');
  const sponsors = useRefOptions('sponsors');

  const doc = form.doc;
  const platformIsOther = (p: string) => getIn(doc, `${p}.platform`) === 'other';
  const trackOptions = ((doc.tracks as { name?: string }[] | undefined) ?? []).filter((t) => t.name).map((t) => ({ value: t.name!, label: t.name! }));

  const afterErrors = AFTER_PATHS.reduce((n, p) => n + form.errorsUnder(p).length, 0);
  const allShown = form.errorsUnder('');
  const beforeErrors = allShown.length - afterErrors;
  const tabs = [
    { id: 'before' as const, label: 'Before the event', errors: beforeErrors },
    { id: 'after' as const, label: 'After the event', errors: afterErrors },
  ];

  return (
    <div className="grid gap-6">
      <div role="tablist" aria-label="Event sections" className="flex flex-wrap gap-2 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`-mb-px min-h-11 border-b-4 px-4 font-bold ${tab === t.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {t.label}
            {t.errors > 0 && <span className="ml-2 rounded-full bg-error px-2 py-0.5 text-sm text-error-foreground" aria-label={`${t.errors} problems`}>{t.errors}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="panel-before" aria-labelledby="tab-before" hidden={tab !== 'before'} className="grid gap-0">
        <Section title="The basics">
          <TextField path="title" label="Title" />
          <TextField path="summary" label="Short summary" hint="One or two sentences. Search engines show this under the title." counter={160} />
          <div className="grid gap-5 sm:grid-cols-3">
            <SelectField path="series" label="Type of event" options={SERIES_OPTS} />
            <SelectField path="size" label="Size" options={SIZE_OPTS} />
            <SelectField path="mode" label="Where" options={MODE_OPTS} />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <DateTimeField path="start" label="Starts" />
            <DateTimeField path="end" label="Ends" />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField path="status" label="Status" hint="Leave as “scheduled” unless the event is cancelled or moved." options={STATUS_OPTS} />
            <DateTimeField path="previousStart" label="It used to start (only if rescheduled)" optional />
          </div>
          <CheckField path="draft" label="Draft" hint="Drafts are saved here but kept off the public site until you untick this and publish." />
        </Section>

        <Section title="Pictures" hint="The poster appears at the top of the event page. Photos are resized and cleaned of location data automatically.">
          <MediaField path="poster" label="Poster" />
          <MediaField path="ogImage" label="Social sharing picture" hint="Shown when the page is shared on LinkedIn or WhatsApp. If empty, the poster is used." />
        </Section>

        <Section title="Overview" hint="What it is about, who it is for, and the level.">
          <MarkdownField path="overview" label="Overview" />
        </Section>

        <Section title="Venue" errorPrefix="venue" hint="Leave this empty for an online-only event.">
            <TextField path="venue.name" label="Venue name" />
            <TextField path="venue.streetAddress" label="Street address" />
            <div className="grid gap-5 sm:grid-cols-3">
              <TextField path="venue.locality" label="City or area" placeholder="Gurugram" />
              <TextField path="venue.region" label="State" placeholder="Haryana" />
              <TextField path="venue.postalCode" label="PIN code" />
            </div>
            <TextField path="venue.mapUrl" label="Map link" type="url" optional />
        </Section>

        <Section title="Registration" hint="Tickets and RSVPs stay on Konfhub and Meetup. The site only links to them.">
          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField path="registration" label="Registration is" options={REG_OPTS} />
            <DateTimeField path="registrationValidFrom" label="Opens on" optional />
          </div>
          <RepeatField path="registrationLinks" label="Registration links" itemLabel="Link" addLabel="Add a link" empty={() => ({ platform: 'konfhub', primary: false })} hint="Mark exactly one as the main button while registration is open.">
            {(p) => (
              <>
                <div className="grid gap-5 sm:grid-cols-2">
                  <SelectField path={`${p}.platform`} label="Where" options={PLATFORM_OPTS} />
                  {platformIsOther(p) && <TextField path={`${p}.label`} label="Name of the site" />}
                </div>
                <TextField path={`${p}.url`} label="Address" type="url" />
                <CheckField path={`${p}.primary`} label="This is the main registration button" />
              </>
            )}
          </RepeatField>
          <TextField path="linkedinUrl" label="LinkedIn event link" type="url" optional />
        </Section>

        <Section title="People">
          <RefPicker path="speakers" label="Speakers" options={speakers.items} empty="No speakers yet. Add them under Speakers first." />
          <RefPicker path="hosts" label="Hosts and volunteers" options={organizers.items} empty="No organizers yet. Add them under Organizers first." />
        </Section>

        <Section title="Schedule" hint="Optional. For a large event, add tracks first, then give each session a track.">
          <RepeatField path="tracks" label="Tracks" itemLabel="Track" addLabel="Add a track" empty={() => ({})}>
            {(p) => <TextField path={`${p}.name`} label="Track name" placeholder="Serverless" />}
          </RepeatField>
          <RepeatField path="agenda" label="Sessions" itemLabel="Session" addLabel="Add a session" empty={() => ({})}>
            {(p) => (
              <>
                <TextField path={`${p}.title`} label="Session title" />
                <div className="grid gap-5 sm:grid-cols-2">
                  <DateTimeField path={`${p}.start`} label="Starts" />
                  <DateTimeField path={`${p}.end`} label="Ends" />
                </div>
                <SelectField path={`${p}.track`} label="Track" optional options={trackOptions} />
                <RefPicker path={`${p}.speakers`} label="Speakers" options={speakers.items} />
              </>
            )}
          </RepeatField>
        </Section>

        <Section title="Sponsors and partners">
          <RepeatField path="sponsors" label="Sponsors" itemLabel="Sponsor" addLabel="Add a sponsor" empty={() => ({ tier: 'community' })}>
            {(p) => (
              <div className="grid gap-5 sm:grid-cols-2">
                <RefSelect path={`${p}.sponsor`} label="Sponsor" options={sponsors.items} />
                <SelectField path={`${p}.tier`} label="How they are listed" options={TIER_OPTS} />
              </div>
            )}
          </RepeatField>
        </Section>

        <Section title="Good to know">
          <StringListField path="whatToBring" label="What to bring" addLabel="Add an item" placeholder="Laptop and charger" />
          <RepeatField path="faqs" label="Questions and answers" itemLabel="Question" addLabel="Add a question" empty={() => ({})}>
            {(p) => (
              <>
                <TextField path={`${p}.q`} label="Question" />
                <TextArea path={`${p}.a`} label="Answer" rows={3} />
              </>
            )}
          </RepeatField>
        </Section>

        <Section title="Community Day extras" hint="Only for large events. Leave empty for other sizes.">
            <TextField path="largeExtras.cfpUrl" label="Call for speakers link" type="url" optional />
            <DateTimeField path="largeExtras.cfpCloses" label="Call for speakers closes" optional />
            <TextField path="largeExtras.sponsorshipPdf" label="Sponsorship brief (PDF link)" type="url" optional />
            <TextArea path="largeExtras.directions" label="Getting there" optional rows={3} />
        </Section>
      </div>

      <div role="tabpanel" id="panel-after" aria-labelledby="tab-after" hidden={tab !== 'after'} className="grid gap-0">
        <Section title="Recap" hint="A short write-up for people who missed it. It appears once the event is over.">
          <MarkdownField path="recap" label="Recap" optional rows={8} />
        </Section>

        <Section title="Photos" hint="Choose a few good ones. Link the full album for the rest.">
          <RepeatField path="gallery" label="Photos" itemLabel="Photo" addLabel="Add a photo" empty={() => ({})}>
            {(p) => (
              <>
                <MediaField path={`${p}.media`} label="Photo" optional={false} />
                <TextField path={`${p}.alt`} label="Describe the photo" hint="For people using screen readers, e.g. “Attendees at the opening keynote”." />
              </>
            )}
          </RepeatField>
          <TextField path="albumUrl" label="Full album link" type="url" optional hint="Google Photos or Drive." />
        </Section>

        <Section title="What attendees said" hint="Typed in from the feedback. Use roles, not names (for example “Attendee, student”).">
          <RepeatField path="feedbackHighlights" label="Quotes" itemLabel="Quote" addLabel="Add a quote" empty={() => ({})}>
            {(p) => (
              <>
                <TextArea path={`${p}.quote`} label="Quote" rows={2} />
                <div className="grid gap-5 sm:grid-cols-2">
                  <TextField path={`${p}.attribution`} label="Who said it" optional placeholder="Attendee, backend developer" />
                  <SelectField path={`${p}.rating`} label="Rating" optional options={RATING_OPTS} />
                </div>
              </>
            )}
          </RepeatField>
        </Section>

        <Section title="Slides and resources">
          <RepeatField path="resources" label="Talks" itemLabel="Talk" addLabel="Add a talk" empty={() => ({})}>
            {(p) => (
              <>
                <TextField path={`${p}.talk`} label="Talk title" />
                <div className="grid gap-5 sm:grid-cols-2">
                  <TextField path={`${p}.slidesUrl`} label="Slides link" type="url" optional />
                  <TextField path={`${p}.repoUrl`} label="Code link" type="url" optional />
                </div>
              </>
            )}
          </RepeatField>
        </Section>

        <Section title="Posts and write-ups">
          <RepeatField path="posts" label="Links" itemLabel="Link" addLabel="Add a link" empty={() => ({ kind: 'blog' })}>
            {(p) => (
              <>
                <SelectField path={`${p}.kind`} label="What it is" options={POST_KIND_OPTS} />
                <TextField path={`${p}.title`} label="Title" />
                <TextField path={`${p}.url`} label="Address" type="url" />
              </>
            )}
          </RepeatField>
        </Section>

        <Section title="By the numbers" hint="Shown on the event page after it is over.">
          <div className="grid gap-5 sm:grid-cols-3">
            <NumberField path="stats.attendees" label="Attendees" />
            <NumberField path="stats.sessions" label="Sessions" />
            <NumberField path="stats.speakers" label="Speakers" />
          </div>
        </Section>
      </div>
    </div>
  );
}

// ===================================================================================================
// Speakers, sponsors, organizers, posts
// ===================================================================================================

export function SpeakerForm() {
  return (
    <div className="grid gap-0">
      <Section title="About the speaker">
        <TextField path="name" label="Name" hint="Speakers are shown by name and photo only. Job titles change too often to keep correct." />
        <MarkdownField path="bio" label="Short bio" optional rows={6} />
        <MediaField path="photo" label="Photo" />
      </Section>
      <Section title="Links">
        <TextField path="linkedin" label="LinkedIn" type="url" optional />
        <TextField path="github" label="GitHub" type="url" optional />
        <TextField path="website" label="Website" type="url" optional />
      </Section>
      <Section title="Permission to publish" hint="Without permission, the site shows only the speaker's name on the event, with no page, photo or bio.">
        <CheckField path="consent.publish" label="The speaker has agreed that we publish their photo and bio" />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField path="consent.date" label="Date they agreed" type="date" optional />
          <TextField path="consent.source" label="Where they agreed" optional placeholder="Sessionize form" />
        </div>
      </Section>
    </div>
  );
}

export function SponsorForm() {
  return (
    <Section title="About the sponsor">
      <TextField path="name" label="Name" />
      <TextField path="url" label="Website" type="url" />
      <SelectField path="defaultTier" label="Usual level" options={TIER_OPTS} />
      <TextArea path="blurb" label="A line about them" optional rows={3} />
      <MediaField path="logo" label="Logo" />
    </Section>
  );
}

export function OrganizerForm() {
  return (
    <Section title="About the organizer">
      <TextField path="name" label="Name" />
      <TextField path="role" label="Role" placeholder="Lead organizer" />
      <MediaField path="photo" label="Photo" />
      <TextField path="linkedin" label="LinkedIn" type="url" optional />
      <CheckField path="active" label="Currently helping to organize" hint="Untick for past organizers. They then no longer appear on the About page." />
    </Section>
  );
}

export function PostForm() {
  const organizers = useRefOptions('organizers');
  const events = useRefOptions('events');
  return (
    <div className="grid gap-0">
      <Section title="The post">
        <TextField path="title" label="Title" />
        <TextField path="description" label="Short description" hint="Shown in the blog list and under the title in search results." counter={160} />
        <div className="grid gap-5 sm:grid-cols-2">
          <DateTimeField path="pubDate" label="Published" />
          <DateTimeField path="updatedDate" label="Last updated" optional />
        </div>
        <RefSelect path="author" label="Author" options={organizers.items} />
        <MarkdownField path="body" label="Post" rows={16} />
        <MediaField path="heroImage" label="Main picture" />
        <CheckField path="draft" label="Draft" hint="Drafts are kept off the public site until you untick this and publish." />
      </Section>
      <Section title="Extras">
        <StringListField path="tags" label="Tags" addLabel="Add a tag" />
        <RefSelect path="relatedEvent" label="Related event" optional options={events.items} />
      </Section>
    </div>
  );
}
