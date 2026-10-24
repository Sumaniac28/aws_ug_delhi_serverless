import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { eventSchema } from '../../src/schema/index.ts';
import { eventDoc } from './helpers/fake-aws.ts';

const parse = (over: Record<string, unknown>) => eventSchema.safeParse(eventDoc(over));
const messages = (r: ReturnType<typeof parse>) => (r.success ? [] : r.error.issues.map((i) => i.message));

describe('ticket types', () => {
  const early = { name: 'Early bird', price: 0, perks: ['Reserved seat'] };
  const general = { name: 'General', price: 499, perks: [], featured: true };

  it('are optional, and an event without them is unchanged', () => {
    const r = parse({});
    assert.ok(r.success);
    assert.deepEqual(r.data.tickets, []);
  });

  it('keep their perks, default to not sold out, and let price be free', () => {
    const r = parse({ tickets: [early, general] });
    assert.ok(r.success, JSON.stringify(messages(r)));
    assert.equal(r.data.tickets[0]!.soldOut, false);
    assert.equal(r.data.tickets[0]!.price, 0);
    assert.deepEqual(r.data.tickets[0]!.perks, ['Reserved seat']);
  });

  it('can be marked sold out later without changing anything else', () => {
    const r = parse({ tickets: [{ ...early, soldOut: true }, general] });
    assert.ok(r.success);
    assert.equal(r.data.tickets[0]!.soldOut, true);
    assert.equal(r.data.tickets[1]!.soldOut, false);
  });

  it('refuse a negative price, an empty name, and unknown fields', () => {
    assert.ok(!parse({ tickets: [{ ...early, price: -1 }] }).success);
    assert.ok(!parse({ tickets: [{ ...early, name: '' }] }).success);
    assert.ok(!parse({ tickets: [{ ...early, stock: 10 }] }).success);
  });

  it('refuse two with the same name, however it is spelled', () => {
    const r = parse({ tickets: [early, { ...early, name: ' EARLY bird ' }] });
    assert.ok(!r.success);
    assert.ok(messages(r).some((m) => /same name/.test(m)));
  });

  it('allow only one "most popular"', () => {
    const r = parse({ tickets: [{ ...early, featured: true }, general] });
    assert.ok(!r.success);
    assert.ok(messages(r).some((m) => /only one ticket/.test(m)));
  });

  it('never carry an online join link, in a perk or the note', () => {
    assert.ok(!parse({ tickets: [{ ...early, perks: ['Join at https://zoom.us/j/123456789'] }] }).success);
    assert.ok(!parse({ tickets: [{ ...early, note: 'Meet at https://meet.google.com/abc-defg-hij' }] }).success);
  });
});

describe('feedback summary and featured quote', () => {
  it('are optional and checked for sensible ranges', () => {
    assert.ok(parse({ feedbackSummary: { responses: 82, averageRating: 4.6, recommendPercent: 94 } }).success);
    assert.ok(!parse({ feedbackSummary: { averageRating: 6 } }).success);
    assert.ok(!parse({ feedbackSummary: { recommendPercent: 120 } }).success);
    assert.ok(!parse({ feedbackSummary: { responses: -3 } }).success);
  });

  it('let one quote be featured', () => {
    const r = parse({ feedbackHighlights: [{ quote: 'Great day.', rating: 5, featured: true }, { quote: 'Good talks.' }] });
    assert.ok(r.success);
    assert.equal(r.data.feedbackHighlights[0]!.featured, true);
  });
});
