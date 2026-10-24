import { SPONSOR_TIERS } from '../../../../src/schema/index.ts';
import { ArticleEditor, TagsField } from '../../form/article.tsx';
import { useForm } from '../../form/context.tsx';
import { CheckField, DateTimeField, MarkdownField, MediaField, RefSelect, Section, SelectField, TextArea, TextField } from '../../form/fields.tsx';
import { CoverPhotoField } from '../../form/photos.tsx';
import { HostSelect } from '../../form/pickers.tsx';
import { useRefOptions } from '../../state/hooks.ts';

export { EventForm } from './event-form.tsx';

const opts = (values: readonly string[], labels: Record<string, string> = {}) => values.map((v) => ({ value: v, label: labels[v] ?? v.charAt(0).toUpperCase() + v.slice(1).replace(/-/g, ' ') }));
const TIER_OPTS = opts(SPONSOR_TIERS, { title: 'Title sponsor', venue: 'Venue partner', community: 'Community partner' });

// ===================================================================================================
// Speakers, sponsors, organizers, posts. (The "draft" switch for posts and events lives next to Save.)
// ===================================================================================================

export function SpeakerForm() {
  return (
    <div className="grid grid-cols-1 gap-6">
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
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
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
  const form = useForm();
  const organizers = useRefOptions('organizers');
  const events = useRefOptions('events');
  const posts = useRefOptions('posts');
  const suggestions = [...new Set(posts.items.flatMap((p) => (Array.isArray(p.tags) ? (p.tags as string[]) : [])))].sort((a, b) => a.localeCompare(b));
  const published = form.doc.pubDate as string | undefined;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
      <div className="grid grid-cols-1 gap-6">
        <Section title="The post">
          <TextField path="title" label="Title" />
          <TextField path="description" label="Short description" hint="Shown in the blog list and under the title in search results." counter={160} />
          <ArticleEditor path="body" label="Post" />
        </Section>
      </div>
      <aside className="grid grid-cols-1 gap-6">
        <Section title="Cover image">
          <CoverPhotoField path="heroImage" galleryPath="__none" label="Main picture" hint="Wide pictures work best (16 by 9). It leads the post and the blog list." />
        </Section>
        <Section title="Details">
          <HostSelect path="author" label="Author" options={organizers.items} reload={organizers.reload} />
          <DateTimeField path="pubDate" label="Published" hint={published ? undefined : 'India time (IST). New posts need a date.'} />
          <DateTimeField path="updatedDate" label="Last updated" optional />
          <TagsField path="tags" label="Tags" suggestions={suggestions} />
          <RefSelect path="relatedEvent" label="Related event" optional options={events.items} />
        </Section>
      </aside>
    </div>
  );
}
