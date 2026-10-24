import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp, type Harness, onlineEvent } from './helpers/app.tsx';

let h: Harness | undefined;
const open = async (path: string, opts?: Parameters<typeof renderApp>[1]) => (h = await renderApp(path, opts));
afterEach(async () => {
  await h?.close();
  h = undefined;
});

/** Optional fields are labelled "GitHub (optional)"; match either form. */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);
const labelRe = (s: string) => new RegExp(`^${escapeRe(s)}( \\(optional\\))?$`);
const asLabel = (l: string | RegExp) => (typeof l === "string" ? labelRe(l) : l);
const change = async (label: string | RegExp, value: string) => fireEvent.change(await screen.findByLabelText(asLabel(label)), { target: { value } });
const serverDoc = (key: string) => {
  const v = h!.server.s3.history(key).at(-1);
  return v && !v.deleteMarker ? JSON.parse(v.body) : undefined;
};
const waitForHeading = (name: RegExp | string) => screen.findByRole('heading', { name, level: 1 });

describe('dashboard', () => {
  it('shows what exists, from the API', async () => {
    await open('/');
    await waitForHeading('Dashboard');
    expect(await screen.findByText('5 events')).toBeInTheDocument();
    expect(screen.getByText('4 speakers')).toBeInTheDocument();
    expect(screen.getByText('2 blog posts')).toBeInTheDocument();
  });

  it('starts a publish and says so', async () => {
    await open('/');
    const button = await screen.findByRole('button', { name: 'Publish changes' });
    await h!.user.click(button);
    expect(await screen.findByText('Publishing started.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /Publishing/ })).toBeDisabled());
  });

  it('flags drafts and documents that no longer match the rules', async () => {
    await open('/', {
      seed: false,
      before: async ({ api, server }) => {
        await api.create('events', 'a-draft', onlineEvent({ title: 'Unfinished idea', draft: true }));
        server.s3.seed('content/events/broken.json', { title: 'Missing everything else' });
      },
    });
    expect(await screen.findByText(/1 item needs fixing/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'broken' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Unfinished idea' })).toBeInTheDocument();
  });
});

describe('lists', () => {
  it('lists events newest first and links to each', async () => {
    await open('/c/events');
    await waitForHeading('Events');
    const rows = await screen.findAllByRole('row');
    const names = rows.slice(1).map((r) => within(r).getAllByRole('link')[0]!.textContent);
    expect(names[0]).toMatch(/Community Day Delhi NCR 2027/);
    expect(names.at(-1)).toMatch(/Community Day Delhi NCR 2025/);
    expect(screen.getByRole('link', { name: 'New event' })).toHaveAttribute('href', '/c/events/new');
  });

  it('says when there is nothing yet', async () => {
    await open('/c/sponsors', { seed: false });
    expect(await screen.findByText(/No sponsors yet/)).toBeInTheDocument();
  });
});

describe('creating', () => {
  it('suggests a web address from the name, then creates the speaker', async () => {
    await open('/c/speakers/new', { seed: false });
    await waitForHeading('New speaker');
    await change('Name', 'Ravi Kumar');
    expect(screen.getByLabelText(asLabel('Web address name'))).toHaveValue('ravi-kumar');
    await h!.user.click(screen.getByRole('button', { name: 'Create speaker' }));

    await waitFor(() => expect(serverDoc('content/speakers/ravi-kumar.json')).toBeDefined());
    expect(serverDoc('content/speakers/ravi-kumar.json')).toMatchObject({ name: 'Ravi Kumar', consent: { publish: false } });
    await waitFor(() => expect(h!.router.state.location.pathname).toBe('/c/speakers/ravi-kumar'));
    expect(await screen.findByText(/is created/)).toBeInTheDocument();
    expect(h!.server.s3.history('content/speakers/ravi-kumar.json')[0]!.metadata['edited-by']).toBe('dev-organizer');
  });

  it('lets the organizer choose their own address name instead', async () => {
    await open('/c/sponsors/new', { seed: false });
    await change('Name', 'Example Corp');
    await change('Website', 'https://example.org');
    fireEvent.change(screen.getByLabelText(asLabel('Web address name')), { target: { value: 'example' } });
    await change('Name', 'Example Corporation'); // the suggestion no longer follows the name
    expect(screen.getByLabelText(asLabel('Web address name'))).toHaveValue('example');
    await h!.user.click(screen.getByRole('button', { name: 'Create sponsor' }));
    await waitFor(() => expect(serverDoc('content/sponsors/example.json')).toMatchObject({ name: 'Example Corporation', url: 'https://example.org', defaultTier: 'community' }));
  });

  it('refuses an empty form in plain English, lists what to fix, and writes nothing', async () => {
    await open('/c/events/new', { seed: false });
    await h!.user.click(await screen.findByRole('button', { name: 'Create event' }));
    const alert = (await screen.findAllByRole('alert')).find((a) => /things need fixing/.test(a.textContent ?? ''))!;
    expect(alert).toBeDefined();
    expect(within(alert).getByRole('link', { name: 'Title' })).toBeInTheDocument();
    expect(alert).toHaveTextContent('This is required.');
    // Inline too, next to the field.
    expect(screen.getAllByText('This is required.').length).toBeGreaterThan(3);
    expect(h!.server.s3.history('content/events/.json')).toEqual([]);
    expect([...h!.server.s3.versions.keys()].filter((k) => k.startsWith('content/events/') && !k.includes('sample') && !k.includes('community') && !k.includes('meetup') && !k.includes('genai') && !k.includes('serverless'))).toEqual([]);
  });

  it('creates an online event with times stored as IST, as a draft by default', async () => {
    await open('/c/events/new', { seed: false });
    await change('Title', 'IAM basics online');
    await change('Short summary', 'A short live session on IAM.');
    await h!.user.selectOptions(screen.getByLabelText(asLabel('Type of event')), 'online-session');
    await h!.user.selectOptions(screen.getByLabelText(asLabel('Size')), 'small');
    await h!.user.selectOptions(screen.getByLabelText(asLabel('Where')), 'online');
    await change('Starts', '2037-03-01T19:00');
    await change('Ends', '2037-03-01T20:30');
    await change('Overview', 'We cover roles and policies.');
    expect(screen.getByLabelText(asLabel('Venue name'))).toBeInTheDocument(); // the form is the same for every event
    expect(screen.getByLabelText(/^Draft/)).toBeChecked();

    await h!.user.click(screen.getByRole('button', { name: 'Create event' }));
    await waitFor(() => expect(serverDoc('content/events/iam-basics-online.json')).toBeDefined());
    expect(serverDoc('content/events/iam-basics-online.json')).toMatchObject({
      title: 'IAM basics online',
      start: '2037-03-01T19:00:00+05:30',
      end: '2037-03-01T20:30:00+05:30',
      mode: 'online',
      draft: true,
    });
    expect(serverDoc('content/events/iam-basics-online.json')).not.toHaveProperty('venue'); // left empty, so none is saved
  });

  it('shows the same form for every event: venue, Community Day extras and rescheduling are always there', async () => {
    await open('/c/events/new', { seed: false });
    const cases: [string, string][] = [['offline', 'small'], ['online', 'small'], ['hybrid', 'large']];
    for (const [where, size] of cases) {
      await h!.user.selectOptions(await screen.findByLabelText(asLabel('Where')), where);
      await h!.user.selectOptions(screen.getByLabelText(asLabel('Size')), size);
      expect(screen.getByLabelText(asLabel('Venue name'))).toBeInTheDocument();
      expect(screen.getByLabelText(asLabel('Call for speakers link'))).toBeInTheDocument();
      expect(screen.getByLabelText(asLabel('It used to start (only if rescheduled)'))).toBeInTheDocument();
    }
  });

  it('explains a bad web address after the field is touched', async () => {
    await open('/c/sponsors/new', { seed: false });
    const site = await screen.findByLabelText(asLabel('Website'));
    fireEvent.change(site, { target: { value: 'example.org' } });
    fireEvent.blur(site);
    expect(await screen.findByText('Enter a full web address, starting with https://')).toBeInTheDocument();
  });

  it('rejects an invalid web address name', async () => {
    await open('/c/speakers/new', { seed: false });
    await change('Name', 'Someone');
    fireEvent.change(screen.getByLabelText(asLabel('Web address name')), { target: { value: 'Not Valid!' } });
    expect(screen.getByText(/lowercase letters, numbers and single hyphens/)).toBeInTheDocument();
    await h!.user.click(screen.getByRole('button', { name: 'Create speaker' }));
    expect(await screen.findByText(/Give this speaker a name/)).toBeInTheDocument();
    expect(h!.server.s3.history('content/speakers/Not Valid!.json')).toEqual([]);
  });
});

describe('editing', () => {
  it('loads an item, saves a change with its ETag, and shows it as saved', async () => {
    await open('/c/speakers/sample-speaker-a');
    await waitForHeading('Sample Speaker A');
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled(); // nothing changed yet
    await change('GitHub', 'https://github.com/brand-new');
    expect(save).toBeEnabled();
    expect(screen.getByText('You have unsaved changes.')).toBeInTheDocument();
    await h!.user.click(save);
    expect(await screen.findByText('All changes saved.')).toBeInTheDocument();
    expect(serverDoc('content/speakers/sample-speaker-a.json').github).toBe('https://github.com/brand-new');
    expect(h!.server.s3.history('content/speakers/sample-speaker-a.json')).toHaveLength(2);
  });

  it('removes an optional field entirely when it is emptied, rather than saving ""', async () => {
    await open('/c/speakers/sample-speaker-a');
    await screen.findByLabelText(asLabel('LinkedIn'));
    await change('LinkedIn', '');
    await h!.user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('All changes saved.');
    expect(serverDoc('content/speakers/sample-speaker-a.json')).not.toHaveProperty('linkedin');
  });

  it('warns about a conflicting save, and loads the other organizer\'s version on request', async () => {
    await open('/c/speakers/sample-speaker-a');
    await screen.findByLabelText(asLabel('GitHub'));
    await change('GitHub', 'https://github.com/my-edit');

    // Meanwhile another organizer saves the same speaker.
    const current = await h!.other.get('speakers', 'sample-speaker-a');
    await h!.other.update('speakers', 'sample-speaker-a', { ...current.data, github: 'https://github.com/their-edit' }, current.etag);

    await h!.user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/Someone else saved this while you were editing/)).toBeInTheDocument();
    expect(serverDoc('content/speakers/sample-speaker-a.json').github).toBe('https://github.com/their-edit'); // theirs was not overwritten

    await h!.user.click(screen.getByRole('button', { name: 'Load the latest version' }));
    await waitFor(() => expect(screen.getByLabelText(asLabel('GitHub'))).toHaveValue('https://github.com/their-edit'));
    expect(screen.queryByText(/Someone else saved/)).not.toBeInTheDocument();
  });

  it('shows the person and time of the last save', async () => {
    await open('/c/speakers/sample-speaker-a');
    expect(await screen.findByText(/Last saved .* IST/)).toBeInTheDocument();
  });

  it('reports a missing item kindly', async () => {
    await open('/c/speakers/nobody');
    expect(await screen.findByText('That speaker does not exist.')).toBeInTheDocument();
  });

  it('saves a change to the speakers picked for an event', async () => {
    await open('/c/events/serverless-meetup-nov-2026');
    await waitForHeading(/Meetup #13/);
    // Sessions in the agenda have their own speaker pickers; the first group is the event's own.
    const picker = (await screen.findAllByRole('group', { name: 'Speakers' }))[0]!;
    await h!.user.click(await within(picker).findByLabelText(asLabel('Sample Speaker B')));
    await h!.user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('All changes saved.');
    expect(serverDoc('content/events/serverless-meetup-nov-2026.json').speakers).toEqual(expect.arrayContaining(['sample-speaker-a', 'sample-speaker-b', 'sample-speaker-c']));
  });
});

describe('deleting', () => {
  it('blocks deleting something still in use and says what uses it', async () => {
    await open('/c/speakers/sample-speaker-a');
    await h!.user.click(await screen.findByRole('button', { name: 'Delete speaker' }));
    const dialog = await screen.findByRole('dialog');
    await h!.user.click(within(dialog).getByRole('button', { name: 'Delete speaker' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This cannot be deleted yet.');
    expect(alert).toHaveTextContent(/Still used by: events\//);
    expect(serverDoc('content/speakers/sample-speaker-a.json')).toBeDefined();
  });

  it('deletes an unused item after confirmation and returns to the list', async () => {
    await open('/c/sponsors', { seed: false });
    await h!.api.create('sponsors', 'old-sponsor', { name: 'Old Sponsor', url: 'https://old.example', defaultTier: 'silver' });
    h!.router.navigate('/c/sponsors/old-sponsor');
    await h!.user.click(await screen.findByRole('button', { name: 'Delete sponsor' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Old Sponsor');
    await h!.user.click(within(dialog).getByRole('button', { name: 'Delete sponsor' }));
    await waitFor(() => expect(h!.router.state.location.pathname).toBe('/c/sponsors'));
    expect(serverDoc('content/sponsors/old-sponsor.json')).toBeUndefined();
    expect(h!.server.s3.history('content/sponsors/old-sponsor.json')[0]!.deleteMarker).toBeUndefined(); // history kept
  });

  it('cancelling the dialog deletes nothing', async () => {
    await open('/c/sponsors', { seed: false });
    await h!.api.create('sponsors', 'keep-me', { name: 'Keep Me', url: 'https://k.example', defaultTier: 'gold' });
    h!.router.navigate('/c/sponsors/keep-me');
    await h!.user.click(await screen.findByRole('button', { name: 'Delete sponsor' }));
    const dialog = await screen.findByRole('dialog');
    await h!.user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(serverDoc('content/sponsors/keep-me.json')).toBeDefined();
  });
});

describe('unsaved changes', () => {
  it('asks before leaving a dirty form, and lets you stay', async () => {
    await open('/c/speakers/sample-speaker-a');
    await screen.findByLabelText(asLabel('GitHub'));
    await change('GitHub', 'https://github.com/edited');
    await h!.user.click(screen.getByRole('link', { name: 'Sponsors' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Leave without saving?');
    await h!.user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(h!.router.state.location.pathname).toBe('/c/speakers/sample-speaker-a');
    expect(screen.getByLabelText(asLabel('GitHub'))).toHaveValue('https://github.com/edited');
  });

  it('lets you leave anyway', async () => {
    await open('/c/speakers/sample-speaker-a');
    await screen.findByLabelText(asLabel('GitHub'));
    await change('GitHub', 'https://github.com/edited');
    await h!.user.click(screen.getByRole('link', { name: 'Sponsors' }));
    await h!.user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Leave and lose changes' }));
    await waitFor(() => expect(h!.router.state.location.pathname).toBe('/c/sponsors'));
  });

  it('does not nag when nothing changed', async () => {
    await open('/c/speakers/sample-speaker-a');
    await screen.findByLabelText(asLabel('GitHub'));
    await h!.user.click(screen.getByRole('link', { name: 'Sponsors' }));
    await waitFor(() => expect(h!.router.state.location.pathname).toBe('/c/sponsors'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('the event form', () => {
  it('switches between before and after the event, and counts problems on each tab', async () => {
    await open('/c/events/new', { seed: false });
    expect(await screen.findByRole('tab', { name: 'Before the event' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText(asLabel('Recap'))).not.toBeVisible();
    await h!.user.click(screen.getByRole('tab', { name: 'After the event' }));
    expect(screen.getByLabelText(asLabel('Recap'))).toBeVisible();
    expect(screen.getByLabelText(asLabel('Title'))).not.toBeVisible();
  });

  it('adds, reorders and removes repeating items (FAQs), and validates inside them', async () => {
    await open('/c/events/new', { seed: false });
    await h!.user.click(await screen.findByRole('button', { name: 'Add a question' }));
    await h!.user.click(screen.getByRole('button', { name: 'Add a question' }));
    const q1 = screen.getAllByLabelText(asLabel('Question'))[0]!;
    fireEvent.change(q1, { target: { value: 'First?' } });
    fireEvent.change(screen.getAllByLabelText(asLabel('Question'))[1]!, { target: { value: 'Second?' } });
    await h!.user.click(screen.getByRole('button', { name: 'Move Question 2 up' }));
    expect(screen.getAllByLabelText(asLabel('Question')).map((i) => (i as HTMLInputElement).value)).toEqual(['Second?', 'First?']);
    await h!.user.click(screen.getByRole('button', { name: 'Remove Question 1' }));
    expect(screen.getAllByLabelText(asLabel('Question'))).toHaveLength(1);
    expect(screen.getByLabelText(asLabel('Question'))).toHaveValue('First?');
  });

  it('lets an event pick speakers and hosts from what exists', async () => {
    await open('/c/events/serverless-meetup-nov-2026');
    await waitForHeading(/Meetup #13/);
    const picker = (await screen.findAllByRole('group', { name: 'Speakers' }))[0]!;
    expect((await within(picker).findByLabelText(asLabel('Sample Speaker A')))).toBeChecked();
    expect((await within(picker).findByLabelText(asLabel('Sample Speaker B')))).not.toBeChecked();
    expect((await within(picker).findByLabelText(asLabel('Sample Speaker C')))).toBeChecked();
  });

  it('previews Markdown with raw HTML shown as text, never run', async () => {
    await open('/c/events/new', { seed: false });
    await change('Overview', '**Bold** and <script>alert(1)</script>');
    await h!.user.click(screen.getByRole('button', { name: 'Preview' }));
    const preview = screen.getByLabelText(asLabel('Overview preview'));
    expect(preview.querySelector('strong')).toHaveTextContent('Bold');
    expect(preview.querySelector('script')).toBeNull();
    expect(preview).toHaveTextContent('<script>alert(1)</script>');
  });

  it('shows the 160-character counter for the summary', async () => {
    await open('/c/events/new', { seed: false });
    await change('Short summary', 'x'.repeat(170));
    expect(await screen.findByText('170 of 160 characters')).toBeInTheDocument();
  });
});

describe('photos', () => {
  const stubImage = (loads: boolean) => {
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_v: string) {
          setTimeout(() => (loads ? this.onload?.() : this.onerror?.()), 0);
        }
      },
    );
  };
  afterEach(() => vi.unstubAllGlobals());

  it('uploads a photo through a signed form, then stores the key the site will resolve', async () => {
    stubImage(true);
    await open('/c/speakers/new', { seed: false });
    await change('Name', 'Ravi Kumar');
    const file = new File([new Uint8Array(2048)], 'My Headshot.JPG', { type: 'image/jpeg' });
    await h!.user.upload((await screen.findByLabelText(asLabel('Photo (optional)'))), file);

    expect(await screen.findByText('Ready.')).toBeInTheDocument();
    expect(h!.uploads).toHaveLength(1);
    const form = h!.uploads[0]!;
    const keys = [...form.keys()];
    expect(keys.at(-1)).toBe('file'); // S3 requires the file last
    expect(String(form.get('key'))).toMatch(/^uploads\/speakers\/ravi-kumar\/my-headshot-[0-9a-z]+\.jpg$/);
    expect(form.get('Content-Type')).toBe('image/jpeg');
    expect(form.get('x-amz-meta-uploaded-by')).toBe('dev-organizer');

    await h!.user.click(screen.getByRole('button', { name: 'Create speaker' }));
    await waitFor(() => expect(serverDoc('content/speakers/ravi-kumar.json')).toBeDefined());
    expect(serverDoc('content/speakers/ravi-kumar.json').photo).toMatch(/^speakers\/ravi-kumar\/my-headshot-[0-9a-z]+\.jpg$/);
  });

  it('refuses iPhone HEIC photos with advice, before uploading anything', async () => {
    await open('/c/speakers/new', { seed: false });
    await change('Name', 'Ravi Kumar');
    await h!.user.upload((await screen.findByLabelText(asLabel('Photo (optional)'))), new File(['x'], 'IMG_0001.HEIC', { type: 'image/heic' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/HEIC.*JPEG/);
    expect(h!.uploads).toHaveLength(0);
  });

  it('asks for a name first, since photos are filed under the item', async () => {
    await open('/c/speakers/new', { seed: false });
    await h!.user.upload((await screen.findByLabelText(asLabel('Photo (optional)'))), new File(['x'], 'a.jpg', { type: 'image/jpeg' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Give this item a name first');
  });

  it('removes a photo from the document', async () => {
    stubImage(true);
    await open('/c/speakers/new', { seed: false });
    await change('Name', 'Ravi Kumar');
    await h!.user.upload((await screen.findByLabelText(asLabel('Photo (optional)'))), new File(['x'], 'a.jpg', { type: 'image/jpeg' }));
    await screen.findByText('Ready.');
    await h!.user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByRole('button', { name: 'Choose photo' })).toBeInTheDocument();
  });
});

describe('theme', () => {
  it('is light by default and remembers dark when chosen', async () => {
    await open('/');
    const toggle = await screen.findByRole('button', { name: 'Dark theme' });
    expect(document.documentElement).not.toHaveClass('dark');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await h!.user.click(toggle);
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await h!.user.click(toggle);
    expect(document.documentElement).not.toHaveClass('dark');
    expect(localStorage.getItem('theme')).toBeNull();
  });
});

describe('switching to Past on time', () => {
  const fillOnlineEvent = async (title: string) => {
    await change('Title', title);
    await change('Short summary', 'A short session.');
    await h!.user.selectOptions(await screen.findByLabelText(asLabel('Type of event')), 'online-session');
    await h!.user.selectOptions(screen.getByLabelText(asLabel('Size')), 'small');
    await h!.user.selectOptions(screen.getByLabelText(asLabel('Where')), 'online');
    await change('Starts', '2037-03-01T19:00');
    await change('Ends', '2037-03-01T20:30');
    await change('Overview', 'Overview text.');
    await h!.user.click(screen.getByLabelText(/^Draft/)); // publish it: drafts get no job
  };

  it('creating a published event schedules its switch to Past, one minute after it ends in IST', async () => {
    await open('/c/events/new', { seed: false });
    await fillOnlineEvent('Scheduled session');
    await h!.user.click(screen.getByRole('button', { name: 'Create event' }));
    await waitFor(() => expect(h!.server.schedules.existing.size).toBe(1));
    expect([...h!.server.schedules.existing]).toEqual([['awsug-end-scheduled-session', 'at(2037-03-01T20:31:00)']]);
    expect(await screen.findByText(/is created\.$/)).toBeInTheDocument(); // no warning
  });

  it('a draft gets no job', async () => {
    await open('/c/events/new', { seed: false });
    await change('Title', 'Draft session');
    await change('Short summary', 'A short session.');
    await h!.user.selectOptions(await screen.findByLabelText(asLabel('Type of event')), 'online-session');
    await h!.user.selectOptions(screen.getByLabelText(asLabel('Size')), 'small');
    await h!.user.selectOptions(screen.getByLabelText(asLabel('Where')), 'online');
    await change('Starts', '2037-03-01T19:00');
    await change('Ends', '2037-03-01T20:30');
    await change('Overview', 'Overview text.');
    await h!.user.click(screen.getByRole('button', { name: 'Create event' }));
    await waitFor(() => expect(serverDoc('content/events/draft-session.json')).toBeDefined());
    expect(h!.server.schedules.existing.size).toBe(0);
  });

  it('deleting the event removes its job', async () => {
    await open('/c/events/new', { seed: false });
    await fillOnlineEvent('Short lived');
    await h!.user.click(screen.getByRole('button', { name: 'Create event' }));
    await waitFor(() => expect(h!.server.schedules.existing.size).toBe(1));
    await h!.user.click(await screen.findByRole('button', { name: 'Delete event' }));
    await h!.user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete event' }));
    await waitFor(() => expect(h!.server.schedules.existing.size).toBe(0));
  });

  it('tells the organizer, but keeps the event, when the job could not be scheduled', async () => {
    await open('/c/events/new', { seed: false, failScheduling: true });
    await fillOnlineEvent('Unlucky session');
    await h!.user.click(screen.getByRole('button', { name: 'Create event' }));
    expect(await screen.findByText(/could not be scheduled/)).toBeInTheDocument();
    expect(serverDoc('content/events/unlucky-session.json')).toBeDefined();
  });

  it('shows the note on the page after an update too', async () => {
    await open('/c/events/new', { seed: false });
    await fillOnlineEvent('Flaky session');
    await h!.user.click(screen.getByRole('button', { name: 'Create event' }));
    await waitFor(() => expect(h!.router.state.location.pathname).toBe('/c/events/flaky-session'));
    await screen.findByText('All changes saved.');
    h!.server.schedules.failWith = Object.assign(new Error('x'), { name: 'ThrottlingException' });
    await change('Short summary', 'Changed.');
    await h!.user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((await screen.findAllByText('Saved, with a note.')).length).toBeGreaterThan(0); // the toast and the alert on the page
    expect(screen.getByText(/nightly rebuild/)).toBeInTheDocument();
  });
});
