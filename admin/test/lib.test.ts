import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig } from '../src/lib/config.ts';
import { formatIst, fromInput, phaseOf, toInput } from '../src/lib/ist.ts';
import { mediaUrl } from '../src/lib/media.ts';
import { append, getIn, move, removeAt, setIn } from '../src/lib/path.ts';
import { isValidId, slugify } from '../src/lib/slug.ts';
import { friendlyMessage, validate } from '../src/lib/validation.ts';

describe('IST handling', () => {
  it('turns what is typed into a +05:30 timestamp and back', () => {
    expect(fromInput('2026-11-14T16:00')).toBe('2026-11-14T16:00:00+05:30');
    expect(toInput('2026-11-14T16:00:00+05:30')).toBe('2026-11-14T16:00');
    expect(fromInput('')).toBe('');
    expect(fromInput('2026-11-14')).toBe('');
  });
  it('shows IST whatever offset the stored value has, and never the computer clock zone', () => {
    expect(toInput('2026-11-14T10:30:00Z')).toBe('2026-11-14T16:00');
    expect(toInput('2026-11-14T05:00:00-05:00')).toBe('2026-11-14T15:30');
    expect(toInput('garbage')).toBe('');
    expect(toInput(undefined)).toBe('');
  });
  it('round-trips across midnight and a year end', () => {
    expect(toInput(fromInput('2026-12-31T23:30'))).toBe('2026-12-31T23:30');
    expect(toInput(fromInput('2027-01-01T00:15'))).toBe('2027-01-01T00:15');
  });
  it('formats for display in IST', () => {
    expect(formatIst('2026-11-14T10:30:00Z')).toBe('14 Nov 2026, 4:00 PM');
    expect(formatIst('')).toBe('');
  });
  it('classifies events by their end time', () => {
    const now = Date.parse('2026-11-14T12:00:00+05:30');
    expect(phaseOf('2026-11-14T16:00:00+05:30', '2026-11-14T19:00:00+05:30', now)).toBe('upcoming');
    expect(phaseOf('2026-11-14T10:00:00+05:30', '2026-11-14T19:00:00+05:30', now)).toBe('today');
    expect(phaseOf('2026-11-13T10:00:00+05:30', '2026-11-13T12:00:00+05:30', now)).toBe('past');
    expect(phaseOf(undefined, undefined, now)).toBeNull();
  });
});

describe('path helpers', () => {
  const doc = { title: 'T', venue: { name: 'V' }, agenda: [{ title: 'A' }, { title: 'B' }] } as Record<string, any>;
  it('reads nested values, safely', () => {
    expect(getIn(doc, 'venue.name')).toBe('V');
    expect(getIn(doc, 'agenda.1.title')).toBe('B');
    expect(getIn(doc, 'venue.missing.deep')).toBeUndefined();
  });
  it('sets values immutably, creating containers as needed', () => {
    const next = setIn(doc, 'venue.city', 'Gurugram');
    expect(next.venue).toEqual({ name: 'V', city: 'Gurugram' });
    expect(doc.venue).toEqual({ name: 'V' });
    expect(setIn({}, 'a.b.c', 1)).toEqual({ a: { b: { c: 1 } } });
    expect(setIn({}, 'list.1.x', 1)).toEqual({ list: [undefined, { x: 1 }] });
  });
  it('removes a key when set to undefined, so cleared optional fields leave no empty strings', () => {
    expect(setIn(doc, 'title', undefined)).not.toHaveProperty('title');
    expect(setIn(doc, 'venue.name', undefined).venue).toEqual({});
  });
  it('appends, removes and moves list items', () => {
    expect(append(doc, 'agenda', { title: 'C' }).agenda.map((a: any) => a.title)).toEqual(['A', 'B', 'C']);
    expect(append({}, 'tags', 'x')).toEqual({ tags: ['x'] });
    expect(removeAt(doc, 'agenda', 0).agenda.map((a: any) => a.title)).toEqual(['B']);
    expect(move(doc, 'agenda', 0, 1).agenda.map((a: any) => a.title)).toEqual(['B', 'A']);
    expect(move(doc, 'agenda', 0, -1)).toBe(doc);
  });
});

describe('slugs', () => {
  it('makes URL-safe ids', () => {
    expect(slugify('AWS UG Delhi NCR Meetup #13: Serverless in Production!')).toBe('aws-ug-delhi-ncr-meetup-13-serverless-in-production');
    expect(slugify('Café  Münch')).toBe('cafe-munch');
    expect(slugify('---')).toBe('');
    expect(slugify('x'.repeat(100)).length).toBeLessThanOrEqual(60);
  });
  it('validates ids the way the API does', () => {
    for (const ok of ['a', 'meetup-13', 'a1-b2']) expect(isValidId(ok)).toBe(true);
    for (const bad of ['', 'Bad', 'has space', '-x', 'x-', 'a--b', '../x', 'x'.repeat(81)]) expect(isValidId(bad)).toBe(false);
  });
  it('slugified text is always a valid id (or empty)', () => {
    for (const t of ['Hello World', 'Ünïcode & symbols!!', '2027 Community Day', 'a - b']) {
      const s = slugify(t);
      expect(s === '' || isValidId(s)).toBe(true);
    }
  });
});

describe('media preview URLs', () => {
  it('points at the processed WebP variants, or the file itself for SVG', () => {
    expect(mediaUrl('https://site.example', 'events/x/poster-ab12.jpg')).toBe('https://site.example/media/events/x/poster-ab12-480.webp');
    expect(mediaUrl('https://site.example', 'events/x/poster-ab12.jpg', 960)).toBe('https://site.example/media/events/x/poster-ab12-960.webp');
    expect(mediaUrl('https://site.example', 'samples/poster.svg')).toBe('https://site.example/media/samples/poster.svg');
  });
});

describe('config', () => {
  const ok = { apiUrl: 'https://api.example/', siteUrl: 'https://site.example/', cognito: { domain: 'https://x.auth.ap-south-1.amazoncognito.com/', clientId: 'abc' } };
  it('accepts a complete config and trims trailing slashes', () => {
    expect(parseConfig(ok)).toMatchObject({ apiUrl: 'https://api.example', siteUrl: 'https://site.example', cognito: { domain: 'https://x.auth.ap-south-1.amazoncognito.com', clientId: 'abc' } });
  });
  it('says exactly what is missing', () => {
    expect(() => parseConfig({ ...ok, apiUrl: '' })).toThrow(/apiUrl/);
    expect(() => parseConfig({ ...ok, siteUrl: undefined })).toThrow(/siteUrl/);
    expect(() => parseConfig({ ...ok, cognito: undefined })).toThrow(ConfigError);
    expect(() => parseConfig(null)).toThrow(ConfigError);
  });
  it('lets dev mode skip Cognito', () => {
    expect(parseConfig({ apiUrl: 'http://localhost:8787', siteUrl: 'http://localhost:8787', devAuth: true }).devAuth).toBe(true);
  });
});

describe('validation messages', () => {
  const event = (over: Record<string, unknown> = {}) => ({
    title: 'Talk', summary: 'A talk.', series: 'meetup', size: 'small', mode: 'online', start: '2027-03-01T19:00:00+05:30', end: '2027-03-01T20:00:00+05:30', overview: 'Hi', ...over,
  });
  const msgs = (doc: Record<string, unknown>) => {
    const r = validate('events', doc);
    return r.ok ? {} : (Object.fromEntries(r.issues.map((i) => [i.path, i.message])) as Record<string, string>);
  };

  it('accepts a valid document and returns the schema defaults filled in', () => {
    const r = validate('events', event());
    expect(r.ok && r.data.status).toBe('scheduled');
  });
  it('says "required" for empty and missing fields, in plain English', () => {
    expect(msgs({ ...event(), title: undefined }).title).toBe('This is required.');
    expect(msgs(event({ title: '' })).title).toBe('This is required.');
  });
  it('explains length, address, date and choice problems', () => {
    const m = msgs(event({ summary: 'x'.repeat(200), series: 'rave', start: 'tomorrow', linkedinUrl: 'linkedin.com/e' }));
    expect(m.summary).toBe('Keep this to 160 characters or fewer.');
    expect(m.series).toBe('Choose one of the options.');
    expect(m.start).toBe('Enter a valid date and time.');
    expect(m.linkedinUrl).toBe('Enter a full web address, starting with https://');
  });
  it('rejects a time with no UTC offset, and an end before the start', () => {
    expect(msgs(event({ start: '2027-03-01T19:00:00' })).start).toBe('Enter a valid date and time.');
    expect(msgs(event({ end: '2027-03-01T18:00:00+05:30' })).end).toBe('End must be after start.');
  });
  it("keeps the schema's own sentences for cross-field rules, and points them at the right field", () => {
    expect(msgs(event({ mode: 'offline' })).venue).toBe('Venue is required unless the event is online-only.');
    expect(msgs(event({ overview: 'Join https://us02web.zoom.us/j/1' }))['']).toMatch(/join links/i);
  });
  it('locates problems inside lists', () => {
    const m = msgs(event({ faqs: [{ q: 'Q', a: 'A' }, { q: '' }] }));
    expect(m['faqs.1.q']).toBe('This is required.');
    expect(m['faqs.1.a']).toBe('This is required.');
  });
  it('validates the other collections with the same rules', () => {
    const r = validate('sponsors', { name: 'Acme', url: 'acme.example', defaultTier: 'gold' });
    expect(r.ok).toBe(false);
    expect(friendlyMessage({ code: 'unrecognized_keys', path: [], message: '' })).toBe('This field is not allowed.');
  });
});
