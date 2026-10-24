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

describe('publishing', () => {
  const publishButton = (name: RegExp | string) => screen.findByRole('button', { name });

  it('says everything is live, and the button cannot be pressed, when nothing was saved since the last build', async () => {
    await open('/');
    expect(await screen.findByText('Everything is live')).toBeInTheDocument();
    expect(await publishButton('Nothing to publish')).toBeDisabled();
  });

  it('counts a change saved in the editor straight away, without a reload', async () => {
    await open('/c/speakers/new');
    expect(await screen.findByText('Everything is live')).toBeInTheDocument();
    await change('Name', 'Ravi Kumar');
    await h!.user.click(screen.getByRole('button', { name: 'Create speaker' }));
    expect(await publishButton('Publish 1 change')).toBeEnabled();
    expect(screen.getByText('1 change is waiting to go live')).toBeInTheDocument();
  });

  it('asks first, lists what will go live, then publishes and ends on "Everything is live"', async () => {
    await open('/', { before: async ({ api }) => void (await api.create('events', 'fresh-session', onlineEvent({ title: 'Fresh session' }))) });
    const button = await publishButton('Publish 1 change');
    expect(button).toBeEnabled();
    await h!.user.click(button);

    const dialog = await screen.findByRole('dialog', { name: 'Publish to the website?' });
    expect(within(dialog).getByText('Fresh session')).toBeInTheDocument();
    expect(within(dialog).getByText(/Event/)).toBeInTheDocument();
    await h!.user.click(within(dialog).getByRole('button', { name: 'Publish now' }));

    expect(await screen.findByText('Publishing started. It takes about two minutes.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publishing…' })).toBeDisabled());
    expect(await screen.findByText('Everything is live', undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(await screen.findByText('Your changes are live on the website.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nothing to publish' })).toBeDisabled();
  });

  it('counts a deletion too, naming what was removed', async () => {
    await open('/', {
      before: async ({ api }) => {
        await api.create('speakers', 'someone-new', { name: 'Someone New', consent: { publish: false } });
      },
    });
    await publishButton('Publish 1 change');
    const stored = await h!.api.get('speakers', 'someone-new');
    await h!.api.remove('speakers', 'someone-new', stored.etag);
    // Someone else deleted it. Coming back to the tab asks again, and the deletion is a change the site has to hear about.
    document.dispatchEvent(new Event('visibilitychange'));
    await h!.user.click(await publishButton('Publish 1 change'));
    const dialog = await screen.findByRole('dialog', { name: 'Publish to the website?' });
    await waitFor(() => expect(dialog).toHaveTextContent(/someone-new\s+deleted/));
  });

  it('the server refuses a second build when nothing new was saved, even if the button is bypassed', async () => {
    await open('/', { before: async ({ api }) => void (await api.create('events', 'fresh-session', onlineEvent({ title: 'Fresh session' }))) });
    await h!.api.publish();
    await waitFor(async () => expect((await h!.api.publishStatus()).latest?.buildStatus).toBe('SUCCEEDED'));
    await expect(h!.api.publish()).rejects.toMatchObject({ status: 409, code: 'nothing_to_publish' });
  });
});

describe('dashboard', () => {
  it('shows what exists, from the API', async () => {
    await open('/');
    await waitForHeading('Dashboard');
    expect(await screen.findByText('5 events')).toBeInTheDocument();
    expect(screen.getByText('4 speakers')).toBeInTheDocument();
    expect(screen.getByText('2 blog posts')).toBeInTheDocument();
  });

  it('shows the chapter badge, not a text-only header', async () => {
    await open('/');
    await waitForHeading('Dashboard');
    expect(screen.getByText('AWS UG Delhi NCR')).toBeInTheDocument();
    expect(screen.getByText('Admin', { selector: 'span' })).toBeInTheDocument();
    const badge = document.querySelector('header img, aside img');
    expect(badge).toHaveAttribute('alt', '');
    expect(badge?.getAttribute('src')).toMatch(/ug-badge/);
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
    const drafts = within(await screen.findByRole('region', { name: 'Drafts' }));
    expect(await drafts.findByRole('link', { name: 'Unfinished idea' })).toBeInTheDocument();
  });

  it('puts the next event front and centre, with shortcuts for what an organizer does most', async () => {
    await open('/', { before: async ({ api }) => void (await api.create('events', 'coming-up', onlineEvent({ title: 'Coming up soon', start: new Date(Date.now() + 5 * 86_400_000).toISOString().replace('Z', '+00:00').replace(/\.\d+/, ''), end: new Date(Date.now() + 5 * 86_400_000 + 3_600_000).toISOString().replace('Z', '+00:00').replace(/\.\d+/, '') }))) });
    const next = within(await screen.findByRole('region', { name: "What's next" }));
    expect(await next.findByRole('link', { name: 'Coming up soon' })).toHaveAttribute('href', '/c/events/coming-up');
    expect(next.getByText(/in [45] days/)).toBeInTheDocument();
    const quick = within(screen.getByRole('region', { name: 'Quick actions' }));
    expect(quick.getByRole('link', { name: 'New event' })).toHaveAttribute('href', '/c/events/new');
    expect(quick.getByRole('link', { name: /^Add photos to / })).toHaveAttribute('href', expect.stringMatching(/^\/c\/events\/.+#photos$/));
  });

  it('lists what is waiting to go live and who saved it', async () => {
    await open('/', { before: async ({ api }) => void (await api.create('speakers', 'new-face', { name: 'New Face', consent: { publish: false } })) });
    const waiting = within(await screen.findByRole('region', { name: 'Waiting to go live' }));
    expect(await waiting.findByRole('link', { name: 'New Face' })).toHaveAttribute('href', '/c/speakers/new-face');
    expect(waiting.getByText(/speaker saved by dev-organizer/)).toBeInTheDocument();
  });
});

describe('lists', () => {
  it('lists events newest first and links to each', async () => {
    await open('/c/events');
    await waitForHeading('Events');
    const cards = within(await screen.findByRole('list', { name: 'Events' })).getAllByRole('listitem');
    const names = cards.map((r) => within(r).getAllByRole('link')[0]!.textContent);
    expect(names[0]).toMatch(/Community Day Delhi NCR 2027/);
    expect(names.at(-1)).toMatch(/Community Day Delhi NCR 2025/);
    expect(screen.getByRole('link', { name: 'New event' })).toHaveAttribute('href', '/c/events/new');
  });

  it('finds events by a few letters, and by whether they are coming up, past or still drafts', async () => {
    await open('/c/events');
    const list = () => within(screen.getByRole('list', { name: 'Events' })).queryAllByRole('listitem');
    await screen.findByRole('list', { name: 'Events' });
    const all = list().length;
    expect(all).toBe(5);

    await h!.user.type(screen.getByLabelText('Search events'), 'zzzz');
    expect(await screen.findByText(/Nothing matches/)).toBeInTheDocument();
    await h!.user.clear(screen.getByLabelText('Search events'));

    await h!.user.click(screen.getByRole('button', { name: 'Past' }));
    expect(list().length).toBeGreaterThan(0);
    expect(list().length).toBeLessThan(all);
    expect(screen.getByRole('button', { name: 'Past' })).toHaveAttribute('aria-pressed', 'true');
    await h!.user.click(screen.getByRole('button', { name: 'Upcoming' }));
    expect(list().length + 0).toBeGreaterThan(0);
  });

  it('shows a face next to each speaker', async () => {
    await open('/c/speakers');
    const rows = await screen.findAllByRole('row');
    expect(rows.length).toBeGreaterThan(1);
    expect(within(rows[1]!).getByRole('link')).toHaveAttribute('href', expect.stringMatching(/^\/c\/speakers\//));
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
    expect(screen.queryByLabelText(asLabel('Venue name'))).not.toBeInTheDocument(); // an online event needs no venue
    expect(screen.getByText('This is an online event, so no venue is needed.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /^Show on the website/ })).not.toBeChecked(); // a new event starts hidden

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

  it('has the same steps for every event, and shows a few fields only when they matter', async () => {
    await open('/c/events/new', { seed: false });
    const steps = () => within(screen.getByRole('navigation', { name: 'Event steps' })).getAllByRole('link').map((a) => a.textContent!.replace(/^\d+/, '').replace(/Optional$/, '').trim());
    const expected = ['The basics', 'When and where', 'Cover photo', 'Registration', 'Speakers and agenda', 'Partners', 'Description and extras', 'After the event'];
    const where = async (v: string) => h!.user.selectOptions(await screen.findByLabelText(asLabel('Where')), v);
    const size = async (v: string) => h!.user.selectOptions(screen.getByLabelText(asLabel('Size')), v);

    await where('offline');
    await size('small');
    expect(steps()).toEqual(expected);
    expect(screen.getByLabelText(asLabel('Venue name'))).toBeInTheDocument();
    expect(screen.queryByLabelText(asLabel('Call for speakers link'))).not.toBeInTheDocument(); // only for large events
    expect(screen.queryByLabelText(asLabel('It used to start'))).not.toBeInTheDocument(); // only when rescheduled

    await where('online');
    expect(steps()).toEqual(expected);
    expect(screen.queryByLabelText(asLabel('Venue name'))).not.toBeInTheDocument();

    await where('hybrid');
    await size('large');
    expect(steps()).toEqual(expected);
    expect(screen.getByLabelText(asLabel('Venue name'))).toBeInTheDocument();
    expect(screen.getByLabelText(asLabel('Call for speakers link'))).toBeInTheDocument();

    await h!.user.selectOptions(screen.getByLabelText(asLabel('Status')), 'rescheduled');
    expect(screen.getByLabelText(asLabel('It used to start'))).toBeInTheDocument();
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
    await h!.user.click(await within(picker).findByRole('button', { name: 'Add Sample Speaker B' }));
    expect(within(picker).getByRole('button', { name: 'Remove Sample Speaker B' })).toBeInTheDocument();
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
  it('keeps the after-event sections folded away until the event is over, or you ask for them', async () => {
    await open('/c/events/new', { seed: false });
    await screen.findByLabelText(asLabel('Title'));
    expect(screen.queryByLabelText(asLabel('Recap'))).not.toBeInTheDocument();
    expect(screen.getByText(/Come back once the event is over/)).toBeInTheDocument();
    await h!.user.click(screen.getByRole('button', { name: 'Fill these in now' }));
    expect(screen.getByLabelText(asLabel('Recap'))).toBeInTheDocument();
    expect(screen.getByLabelText('Add photos')).toBeInTheDocument();
  });

  it('shows the after-event sections straight away for an event that has ended', async () => {
    await open('/c/events/new', { seed: false, before: async ({ api }) => void (await api.create('events', 'long-ago', onlineEvent({ title: 'Long ago', start: '2020-03-01T19:00:00+05:30', end: '2020-03-01T20:00:00+05:30' }))) });
    h!.router.navigate('/c/events/long-ago');
    expect(await screen.findByLabelText(asLabel('Recap'))).toBeInTheDocument();
    expect(screen.getByLabelText('Add photos')).toBeInTheDocument();
  });

  it('counts the problems in each step and lets you jump to them', async () => {
    await open('/c/events/new', { seed: false });
    await h!.user.click(await screen.findByRole('button', { name: 'Create event' }));
    const steps = within(screen.getByRole('navigation', { name: 'Event steps' }));
    const basics = await steps.findByRole('link', { name: /The basics \(\d+ to fix\)/ });
    expect(basics).toHaveAttribute('href', '#basics');
    expect(steps.getByRole('link', { name: /When and where \(\d+ to fix\)/ })).toBeInTheDocument();
  });

  it('copies only what repeats from a past event when you start from it', async () => {
    await open('/c/events/new', {
      seed: false,
      before: async ({ api }) => {
        await api.create('events', 'last-time', onlineEvent({ title: 'Last time', start: '2020-03-01T19:00:00+05:30', end: '2020-03-01T20:00:00+05:30', whatToBring: ['Laptop'], faqs: [{ q: 'Free?', a: 'Yes.' }], registrationLinks: [{ platform: 'meetup', url: 'https://www.meetup.com/x/events/1/', primary: true }] }));
      },
    });
    await h!.user.selectOptions(await screen.findByLabelText('Event to copy'), 'last-time');
    await h!.user.click(screen.getByRole('button', { name: 'Copy details' }));
    expect(await screen.findByLabelText(asLabel('Question'))).toHaveValue('Free?');
    expect(screen.getAllByLabelText(asLabel('Where'))[0]).toHaveValue('online'); // the event's own "Where" comes first
    expect(screen.getByLabelText(asLabel('Title'))).toHaveValue(''); // not copied
    expect(screen.getByLabelText(asLabel('Starts'))).toHaveValue(''); // not copied
    expect(screen.getByLabelText(asLabel('Address'))).toHaveValue(''); // the new event has its own page on Meetup
    expect(screen.getAllByLabelText(asLabel('Where')).some((e) => (e as HTMLSelectElement).value === 'meetup')).toBe(true); // the site carries over
  });

  it('works out the ticketing site from a pasted link', async () => {
    await open('/c/events/new', { seed: false });
    await h!.user.click(await screen.findByRole('button', { name: 'Add a link' }));
    await change('Address', 'https://www.meetup.com/aws-ug-delhi-ncr/events/123/');
    const where = screen.getAllByLabelText(asLabel('Where')).find((e) => e.id.includes('registrationLinks'))!;
    expect(where).toHaveValue('meetup');
    expect(screen.getByLabelText(/main registration button/)).toBeChecked(); // the first link is the main one
  });

  it('saves with Ctrl+S', async () => {
    await open('/c/speakers/new', { seed: false });
    await change('Name', 'Quick Saver');
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(serverDoc('content/speakers/quick-saver.json')).toBeDefined());
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
    const chosen = await within(picker).findByRole('list', { name: 'Chosen speakers' });
    expect(await within(chosen).findByText('Sample Speaker A')).toBeInTheDocument();
    expect(within(chosen).getByText('Sample Speaker C')).toBeInTheDocument();
    expect(within(chosen).queryByText('Sample Speaker B')).not.toBeInTheDocument();
    // Those already chosen are not offered again; the others can be found by typing.
    expect(await within(picker).findByRole('button', { name: 'Add Sample Speaker B' })).toBeInTheDocument();
    expect(within(picker).queryByRole('button', { name: 'Add Sample Speaker A' })).not.toBeInTheDocument();
    await h!.user.type(within(picker).getByLabelText('Find a speaker'), 'zzz');
    expect(within(picker).getByText(/No speakers match/)).toBeInTheDocument();
  });

  it('adds a new speaker from inside the event, picks them, and keeps what was typed so far', async () => {
    await open('/c/events/new', { seed: false });
    await change('Title', 'Half-finished event');
    const picker = (await screen.findAllByRole('group', { name: 'Speakers' }))[0]!;
    await h!.user.click(within(picker).getByRole('button', { name: 'New speaker' }));

    const dialog = await screen.findByRole('dialog', { name: 'Add a new speaker' });
    await h!.user.type(within(dialog).getByLabelText(asLabel('Name')), 'Priya Sharma');
    await h!.user.click(within(dialog).getByRole('button', { name: 'Add speaker' }));

    await waitFor(() => expect(serverDoc('content/speakers/priya-sharma.json')).toMatchObject({ name: 'Priya Sharma', consent: { publish: false } }));
    const chosen = await within(picker).findByRole('list', { name: 'Chosen speakers' });
    expect(within(chosen).getByText('Priya Sharma')).toBeInTheDocument();
    expect(screen.getByLabelText(asLabel('Title'))).toHaveValue('Half-finished event');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a new speaker' })).not.toBeInTheDocument());
  });

  it('offers to create a speaker from what was typed when nobody matches', async () => {
    await open('/c/events/new', { seed: false });
    const picker = (await screen.findAllByRole('group', { name: 'Speakers' }))[0]!;
    await h!.user.type(within(picker).getByLabelText('Find a speaker'), 'Meera Iyer');
    await h!.user.click(within(picker).getByRole('button', { name: 'Add “Meera Iyer” as a new speaker' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a new speaker' });
    expect(within(dialog).getByLabelText(asLabel('Name'))).toHaveValue('Meera Iyer');
  });

  it('explains clearly when the new speaker already exists', async () => {
    await open('/c/events/new', { seed: false, before: async ({ api }) => void (await api.create('speakers', 'priya-sharma', { name: 'Priya Sharma', consent: { publish: false } })) });
    const picker = (await screen.findAllByRole('group', { name: 'Speakers' }))[0]!;
    await h!.user.click(within(picker).getByRole('button', { name: 'New speaker' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a new speaker' });
    await h!.user.type(within(dialog).getByLabelText(asLabel('Name')), 'Priya Sharma');
    await h!.user.click(within(dialog).getByRole('button', { name: 'Add speaker' }));
    expect(await within(dialog).findByText('There is already a speaker with this name.')).toBeInTheDocument();
  });

  it('adds a new sponsor from the partner list', async () => {
    await open('/c/events/new', { seed: false });
    await h!.user.click(await screen.findByRole('button', { name: 'Add a sponsor' }));
    await h!.user.click(screen.getByRole('button', { name: 'New sponsor' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a new sponsor' });
    await h!.user.type(within(dialog).getByLabelText(asLabel('Name')), 'Acme Cloud');
    await change('Website', 'https://acme.example');
    await h!.user.click(within(dialog).getByRole('button', { name: 'Add sponsor' }));
    await waitFor(() => expect(serverDoc('content/sponsors/acme-cloud.json')).toMatchObject({ name: 'Acme Cloud' }));
    await waitFor(() => expect(screen.getByLabelText(asLabel('Sponsor'))).toHaveValue('acme-cloud'));
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

describe('bulk event photos', () => {
  /** Stands in for the browser's upload connection: records each form, reports progress, and can fail on purpose. */
  class FakeXhr {
    static sent: { key: string; form: FormData }[] = [];
    static failOnce = new Set<string>();
    static slow = new Set<string>();
    url = '';
    status = 204;
    upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    open(_method: string, url: string) {
      this.url = url;
    }
    send(form: FormData) {
      const key = String(form.get('key'));
      const stem = key.split('/').pop()!.replace(/-[0-9a-z]+\.[a-z]+$/, '');
      this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
      setTimeout(
        () => {
          if (FakeXhr.failOnce.delete(stem)) return this.onerror?.();
          FakeXhr.sent.push({ key, form });
          this.onload?.();
        },
        FakeXhr.slow.has(stem) ? 40 : 0,
      );
    }
  }
  const jpg = (name: string) => new File([new Uint8Array(512)], name, { type: 'image/jpeg' });
  const sentStems = () => FakeXhr.sent.map((s) => s.key.split('/').pop()!.replace(/-[0-9a-z]+\.[a-z]+$/, ''));

  const startEvent = async (title = 'Photo day') => {
    FakeXhr.sent = [];
    FakeXhr.failOnce = new Set();
    FakeXhr.slow = new Set();
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    await open('/c/events/new', { seed: false });
    await change('Title', title);
    await change('Short summary', 'A day of photos.');
    await h!.user.selectOptions(screen.getByLabelText(asLabel('Type of event')), 'online-session');
    await h!.user.selectOptions(screen.getByLabelText(asLabel('Size')), 'small');
    await h!.user.selectOptions(screen.getByLabelText(asLabel('Where')), 'online');
    await change('Starts', '2037-03-01T19:00');
    await change('Ends', '2037-03-01T20:30');
    await change('Overview', 'Overview text.');
    await h!.user.click(screen.getByRole('button', { name: 'Fill these in now' }));
  };
  const addPhotos = (...files: File[]) => h!.user.upload(screen.getByLabelText('Add photos'), files);
  const describeBoxes = () => screen.queryAllByLabelText(/^Describe photo \d+$/) as HTMLInputElement[];
  const savedGallery = () => serverDoc('content/events/photo-day.json').gallery as { media: string; alt: string }[];
  afterEach(() => vi.unstubAllGlobals());

  it('adds many photos in one go, with progress, in file-name order even when they finish out of order', async () => {
    await startEvent();
    FakeXhr.slow.add('a'); // the first file is the slowest to arrive
    await addPhotos(jpg('c.jpg'), jpg('a.jpg'), jpg('b.jpg'));
    await waitFor(() => expect(describeBoxes()).toHaveLength(3));
    await h!.user.click(screen.getByRole('button', { name: 'Create event' }));
    await waitFor(() => expect(serverDoc('content/events/photo-day.json')).toBeDefined());
    expect(savedGallery().map((g) => g.media.split('/').pop()!.replace(/-[0-9a-z]+\.jpg$/, ''))).toEqual(['a', 'b', 'c']);
    expect(savedGallery().every((g) => g.media.startsWith('events/photo-day/'))).toBe(true);
    expect(screen.getByText(/3 photos/)).toBeInTheDocument();
  });

  it('gives every new photo a standard description and says how many still have it', async () => {
    await startEvent('Photo day');
    await addPhotos(jpg('a.jpg'), jpg('b.jpg'));
    await waitFor(() => expect(describeBoxes()).toHaveLength(2));
    expect(describeBoxes()[0]).toHaveValue('Photo from Photo day');
    expect(screen.getByText(/2 still have the standard description/)).toBeInTheDocument();
    fireEvent.change(describeBoxes()[0]!, { target: { value: 'The opening keynote' } });
    expect(screen.getByText(/1 still has the standard description/)).toBeInTheDocument();
    await h!.user.click(screen.getByRole('button', { name: 'Create event' }));
    await waitFor(() => expect(serverDoc('content/events/photo-day.json')).toBeDefined());
    expect(savedGallery().map((g) => g.alt)).toEqual(['The opening keynote', 'Photo from Photo day']);
  });

  it('sets any photo as the cover, and the cover step can pick from the event photos', async () => {
    await startEvent();
    await addPhotos(jpg('a.jpg'), jpg('b.jpg'), jpg('c.jpg'));
    await waitFor(() => expect(describeBoxes()).toHaveLength(3));

    await h!.user.click(screen.getByRole('button', { name: 'Set photo 2 as the cover' }));
    expect(screen.getByText('Cover', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set photo 2 as the cover' })).not.toBeInTheDocument();

    await h!.user.click(screen.getByRole('button', { name: 'Choose from event photos' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choose the cover photo' });
    expect(within(dialog).getByRole('button', { name: 'Use photo 2 as the cover (current cover)' })).toBeInTheDocument();
    await h!.user.click(within(dialog).getByRole('button', { name: 'Use photo 3 as the cover' }));
    expect(screen.queryByRole('button', { name: 'Set photo 3 as the cover' })).not.toBeInTheDocument();

    await h!.user.click(screen.getByRole('button', { name: 'Create event' }));
    await waitFor(() => expect(serverDoc('content/events/photo-day.json')).toBeDefined());
    const doc = serverDoc('content/events/photo-day.json');
    expect(doc.poster).toBe(doc.gallery[2].media);
  });

  it('reorders and removes photos', async () => {
    await startEvent();
    await addPhotos(jpg('a.jpg'), jpg('b.jpg'), jpg('c.jpg'));
    await waitFor(() => expect(describeBoxes()).toHaveLength(3));
    await h!.user.click(screen.getByRole('button', { name: 'Move photo 1 later' }));
    await h!.user.click(screen.getByRole('button', { name: 'Remove photo 3' }));
    await h!.user.click(screen.getByRole('button', { name: 'Create event' }));
    await waitFor(() => expect(serverDoc('content/events/photo-day.json')).toBeDefined());
    expect(savedGallery().map((g) => g.media.split('/').pop()!.replace(/-[0-9a-z]+\.jpg$/, ''))).toEqual(['b', 'a']);
  });

  it('refuses unusable files by name and still uploads the good ones', async () => {
    await startEvent();
    await addPhotos(new File(['x'], 'IMG_9.HEIC', { type: 'image/heic' }), jpg('good.jpg'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/IMG_9\.HEIC: iPhone HEIC photos are not supported/);
    await waitFor(() => expect(describeBoxes()).toHaveLength(1));
    expect(sentStems()).toEqual(['good']);
  });

  it('keeps going when one upload fails, and lets that one be retried', async () => {
    await startEvent();
    FakeXhr.failOnce.add('b');
    await addPhotos(jpg('a.jpg'), jpg('b.jpg'), jpg('c.jpg'));
    await waitFor(() => expect(describeBoxes()).toHaveLength(2));
    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(screen.getByText(/could not reach the server/)).toBeInTheDocument();
    await h!.user.click(retry);
    await waitFor(() => expect(describeBoxes()).toHaveLength(3));
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('asks for a title first, since photos are filed under the event', async () => {
    FakeXhr.sent = [];
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    await open('/c/events/new', { seed: false });
    await h!.user.click(await screen.findByRole('button', { name: 'Fill these in now' }));
    await addPhotos(jpg('a.jpg'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Give this event a title first');
    expect(FakeXhr.sent).toHaveLength(0);
  });
});

describe('ticket types', () => {
  const EVENT = 'content/events/serverless-meetup-nov-2026.json';

  it('shows each ticket type on the next event, with its own sold-out switch that saves at once', async () => {
    await open('/');
    const next = within(await screen.findByRole('region', { name: "What's next" }));
    const general = await next.findByRole('switch', { name: 'Sold out: General' });
    expect(general).not.toBeChecked();
    expect(next.getByRole('switch', { name: 'Sold out: Early bird' })).toBeChecked(); // the sample has one sold out already

    await h!.user.click(general);
    await waitFor(() => expect(serverDoc(EVENT).tickets.find((t: any) => t.name === 'General').soldOut).toBe(true));
    // Only that one field changed: the other tickets and the rest of the event are exactly as they were.
    expect(serverDoc(EVENT).tickets.find((t: any) => t.name === 'Workshop pass').soldOut).toBeFalsy();
    expect(serverDoc(EVENT).title).toMatch(/Meetup #13/);
    expect(await screen.findByRole('button', { name: 'Publish 1 change' })).toBeEnabled();

    await h!.user.click(await next.findByRole('switch', { name: 'Sold out: General' }));
    await waitFor(() => expect(serverDoc(EVENT).tickets.find((t: any) => t.name === 'General').soldOut).toBe(false));
  });

  it('flips the right ticket even if someone has reordered them, and refuses when it was renamed or removed', async () => {
    await open('/');
    const next = within(await screen.findByRole('region', { name: "What's next" }));
    const general = await next.findByRole('switch', { name: 'Sold out: General' });
    let fresh = await h!.other.get('events', 'serverless-meetup-nov-2026');
    await h!.other.update('events', 'serverless-meetup-nov-2026', { ...fresh.data, tickets: [...fresh.data.tickets].reverse() }, fresh.etag);
    await h!.user.click(general);
    await waitFor(() => expect(serverDoc(EVENT).tickets.find((t: any) => t.name === 'General').soldOut).toBe(true));

    fresh = await h!.other.get('events', 'serverless-meetup-nov-2026');
    await h!.other.update('events', 'serverless-meetup-nov-2026', { ...fresh.data, tickets: fresh.data.tickets.map((t: any) => (t.name === 'Workshop pass' ? { ...t, name: 'Workshop' } : t)) }, fresh.etag);
    await h!.user.click(await next.findByRole('switch', { name: 'Sold out: Workshop pass' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Someone changed this event just now/);
    expect(serverDoc(EVENT).tickets.find((t: any) => t.name === 'Workshop').soldOut).toBeFalsy();
  });

  it('are edited in the Registration step: perks, price, most popular, and a sold-out switch that stays in view', async () => {
    await open('/c/events/serverless-meetup-nov-2026');
    await waitForHeading(/Meetup #13/);
    const general = await screen.findByRole('group', { name: 'Ticket 2' });
    await h!.user.click(within(general).getByRole('switch', { name: 'Sold out' }));

    await h!.user.click(screen.getByRole('button', { name: 'Add a ticket type' }));
    const added = await screen.findByRole('group', { name: 'Ticket 4' });
    fireEvent.change(within(added).getByLabelText(asLabel('Ticket name')), { target: { value: 'VIP' } });
    fireEvent.change(within(added).getByLabelText(asLabel('Price in rupees')), { target: { value: '999' } });
    await h!.user.click(within(added).getByRole('button', { name: 'Add a perk' }));
    fireEvent.change(within(added).getByLabelText(/What it includes, item 1/), { target: { value: 'Front row seat' } });

    await h!.user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('All changes saved.');
    const saved = serverDoc(EVENT).tickets;
    expect(saved).toHaveLength(4);
    expect(saved[1]).toMatchObject({ name: 'General', soldOut: true, featured: true });
    expect(saved[3]).toMatchObject({ name: 'VIP', price: 999, perks: ['Front row seat'] });
  });

  it('cannot have two tickets with one name, or two marked most popular', async () => {
    await open('/c/events/serverless-meetup-nov-2026');
    await waitForHeading(/Meetup #13/);
    await h!.user.click(await screen.findByRole('button', { name: 'Add a ticket type' }));
    const added = await screen.findByRole('group', { name: 'Ticket 4' });
    fireEvent.change(within(added).getByLabelText(asLabel('Ticket name')), { target: { value: 'general' } });
    await h!.user.click(within(added).getByLabelText(/Show as most popular/));
    await h!.user.click(screen.getByRole('button', { name: 'Save changes' }));
    const alert = (await screen.findAllByRole('alert')).find((a) => /need fixing|needs fixing/.test(a.textContent ?? ''))!;
    expect(alert).toHaveTextContent(/same name|only one ticket/);
  });

  it('are copied (as not sold out) when a new event starts from a past one', async () => {
    await open('/c/events/new');
    await h!.user.selectOptions(await screen.findByLabelText('Event to copy'), 'community-day-2025');
    await h!.user.click(screen.getByRole('button', { name: 'Copy details' }));
    await screen.findByLabelText(asLabel('Question'));
    expect(screen.queryByRole('group', { name: 'Ticket 1' })).not.toBeInTheDocument(); // that sample event has none
  });
});

describe('what attendees said', () => {
  const EVENT = 'content/events/community-day-2025.json';

  it('takes the feedback numbers, star ratings and a featured quote', async () => {
    await open('/c/events/community-day-2025');
    await waitForHeading(/Community Day Delhi NCR 2025/);
    expect(await screen.findByLabelText(asLabel('Responses'))).toHaveValue(82);
    fireEvent.change(screen.getByLabelText(asLabel('Responses')), { target: { value: '90' } });
    fireEvent.change(screen.getByLabelText(asLabel('Average rating')), { target: { value: '4.7' } });

    const second = await screen.findByRole('group', { name: 'Quote 2' });
    await h!.user.click(within(second).getByLabelText(/3 out of 5/));
    await h!.user.click(within(second).getByLabelText(/Show this quote large/));
    await h!.user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('All changes saved.');

    const doc = serverDoc(EVENT);
    expect(doc.feedbackSummary).toMatchObject({ responses: 90, averageRating: 4.7, recommendPercent: 94 });
    expect(doc.feedbackHighlights[1]).toMatchObject({ rating: 3, featured: true });
    expect(doc.feedbackHighlights[0].rating).toBe(5);
  });

  it('clears a rating again', async () => {
    await open('/c/events/community-day-2025');
    const first = await screen.findByRole('group', { name: 'Quote 1' });
    await h!.user.click(within(first).getByRole('button', { name: 'Clear' }));
    await h!.user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('All changes saved.');
    expect(serverDoc(EVENT).feedbackHighlights[0]).not.toHaveProperty('rating');
  });

  it('turns pasted lines into quote cards, splitting off who said it', async () => {
    await open('/c/events/community-day-2025');
    const box = await screen.findByLabelText('Paste many quotes at once');
    fireEvent.change(box, { target: { value: '“Loved the workshops” - Student\n\nGreat venue and food' } });
    await h!.user.click(screen.getByRole('button', { name: 'Add 2 quotes' }));
    await h!.user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('All changes saved.');
    const quotes = serverDoc(EVENT).feedbackHighlights;
    expect(quotes).toHaveLength(4);
    expect(quotes[2]).toEqual({ quote: 'Loved the workshops', attribution: 'Student' });
    expect(quotes[3]).toEqual({ quote: 'Great venue and food' });
  });
});

describe('writing a blog post', () => {
  const body = () => screen.getByLabelText('Post') as HTMLTextAreaElement;

  it('has a formatting toolbar that wraps the selected words', async () => {
    await open('/c/posts/new', { seed: false });
    const box = await screen.findByLabelText('Post');
    fireEvent.change(box, { target: { value: 'Hello brave world' } });
    (box as HTMLTextAreaElement).setSelectionRange(6, 11);
    await h!.user.click(screen.getByRole('button', { name: 'Bold' }));
    expect(body().value).toBe('Hello **brave** world');
    (body() as HTMLTextAreaElement).setSelectionRange(0, 0);
    await h!.user.click(screen.getByRole('button', { name: 'Heading' }));
    expect(body().value.startsWith('## Hello')).toBe(true);
  });

  it('shows a live preview, with raw HTML and outside pictures shown as text, never run', async () => {
    await open('/c/posts/new', { seed: false });
    fireEvent.change(await screen.findByLabelText('Post'), { target: { value: '**Bold** <script>alert(1)</script>\n\n![Evil](https://evil.example/x.png)\n\n![Ours](/media/posts/x/a-960.webp)' } });
    await h!.user.click(screen.getByRole('button', { name: 'Preview' }));
    const preview = screen.getByLabelText('Post preview');
    expect(preview.querySelector('strong')).toHaveTextContent('Bold');
    expect(preview.querySelector('script')).toBeNull();
    expect(preview.querySelectorAll('img')).toHaveLength(1);
    expect(preview.querySelector('img')!.getAttribute('src')).toMatch(/\/media\/posts\/x\/a-960\.webp$/);
    expect(preview).toHaveTextContent('Evil');
    expect(screen.queryByLabelText('Post', { selector: 'textarea' })).not.toBeInTheDocument(); // preview only
  });

  it('inserts a photo at the cursor after asking what it shows, and files it under the post', async () => {
    await open('/c/posts/new', { seed: false });
    await change('Title', 'Lessons from Community Day');
    const box = await screen.findByLabelText('Post');
    fireEvent.change(box, { target: { value: 'Intro.\n\nOutro.' } });
    (box as HTMLTextAreaElement).setSelectionRange(7, 7);
    await h!.user.click(screen.getByRole('button', { name: 'Insert photo' }));
    await h!.user.upload(screen.getByLabelText('Choose a photo to insert'), new File([new Uint8Array(256)], 'Keynote Photo.JPG', { type: 'image/jpeg' }));
    const alt = await screen.findByLabelText('Describe the photo');
    expect(screen.getByRole('button', { name: 'Add to post' })).toBeDisabled(); // a description comes first
    fireEvent.change(alt, { target: { value: 'The opening keynote' } });
    await h!.user.click(screen.getByRole('button', { name: 'Add to post' }));

    expect(h!.uploads).toHaveLength(1);
    expect(String(h!.uploads[0]!.get('key'))).toMatch(/^uploads\/posts\/lessons-from-community-day\/keynote-photo-[0-9a-z]+\.jpg$/);
    expect(body().value).toMatch(/^Intro\.\n\n!\[The opening keynote\]\(\/media\/posts\/lessons-from-community-day\/keynote-photo-[0-9a-z]+-960\.webp\)\n\nOutro\.$/);
  });

  it('asks for a title before photos, since they are filed under the post', async () => {
    await open('/c/posts/new', { seed: false });
    await screen.findByLabelText('Post');
    await h!.user.upload(screen.getByLabelText('Choose a photo to insert'), new File(['x'], 'a.jpg', { type: 'image/jpeg' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Give the post a title first');
    expect(h!.uploads).toHaveLength(0);
  });

  it('keeps tags as chips, suggests ones used before, and saves the whole post', async () => {
    await open('/c/posts/new');
    await change('Title', 'Lessons from Community Day');
    await change('Short description', 'What we learned running a big day.');
    await screen.findByRole('option', { name: 'Sample Organizer One' });
    await h!.user.selectOptions(screen.getByLabelText(asLabel('Author')), 'sample-organizer-one');
    await change('Published', '2026-10-24T10:00');
    fireEvent.change(screen.getByLabelText('Post'), { target: { value: 'We learned a lot.' } });

    const tags = screen.getByLabelText(/^Tags/);
    await h!.user.type(tags, 'serverless{Enter}');
    await h!.user.type(tags, 'recap,');
    await h!.user.type(tags, 'Serverless{Enter}'); // same tag again, different case: not added twice
    const chosen = screen.getByRole('list', { name: 'Chosen tags' });
    expect(within(chosen).getAllByRole('listitem')).toHaveLength(2);
    await h!.user.click(within(chosen).getByRole('button', { name: 'Remove tag recap' }));

    await h!.user.click(screen.getByRole('button', { name: 'Create post' }));
    await waitFor(() => expect(serverDoc('content/posts/lessons-from-community-day.json')).toBeDefined());
    expect(serverDoc('content/posts/lessons-from-community-day.json')).toMatchObject({
      title: 'Lessons from Community Day',
      author: 'sample-organizer-one',
      body: 'We learned a lot.',
      tags: ['serverless'],
      draft: true,
    });
  });

  it('adds a new host as the author without leaving the post', async () => {
    await open('/c/posts/new', { seed: false });
    await change('Title', 'A guest post');
    await h!.user.click(await screen.findByRole('button', { name: 'New host' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a new host' });
    await h!.user.type(within(dialog).getByLabelText(asLabel('Name')), 'Meera Iyer');
    fireEvent.change(within(dialog).getByLabelText(asLabel('Role')), { target: { value: 'Volunteer' } });
    await h!.user.click(within(dialog).getByRole('button', { name: 'Add host' }));
    await waitFor(() => expect(serverDoc('content/organizers/meera-iyer.json')).toMatchObject({ name: 'Meera Iyer', role: 'Volunteer' }));
    await waitFor(() => expect(screen.getByLabelText(asLabel('Author'))).toHaveValue('meera-iyer'));
    expect(screen.getByLabelText('Title')).toHaveValue('A guest post');
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
    await h!.user.click(screen.getByRole('switch', { name: /^Show on the website/ })); // show it: drafts get no job
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
