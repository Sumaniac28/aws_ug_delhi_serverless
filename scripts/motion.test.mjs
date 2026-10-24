// Logic behind the countdown board and the count-up numbers (src/lib/motion). Run: npm run test:motion
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { easeOutCubic, formatCount, valueAt } from '../src/lib/motion/count.ts';
import { countdownState, formatCountdown } from '../src/lib/motion/countdown.ts';

const START = '2026-11-14T10:00:00+05:30';
const END = '2026-11-14T13:00:00+05:30';
const at = (iso) => Date.parse(iso);

describe('countdown', () => {
  it('counts down to the start, in whole days, hours, minutes and seconds', () => {
    const s = countdownState(START, END, at('2026-11-11T05:47:51+05:30'));
    assert.deepEqual(s, { kind: 'before', days: 3, hours: 4, minutes: 12, seconds: 9 });
    assert.equal(formatCountdown(s), '3d 04:12:09');
  });

  it('is right for a visitor in another time zone (the instants carry their offset)', () => {
    // 05:47:51 IST is 00:17:51 UTC.
    assert.deepEqual(countdownState(START, END, at('2026-11-11T00:17:51Z')), countdownState(START, END, at('2026-11-11T05:47:51+05:30')));
  });

  it('drops the day count on the day itself', () => {
    assert.equal(formatCountdown(countdownState(START, END, at('2026-11-14T09:59:59+05:30'))), '00:00:01');
  });

  it('says the event is happening from the start until the end, then that it has ended', () => {
    assert.deepEqual(countdownState(START, END, at(START)), { kind: 'live' });
    assert.deepEqual(countdownState(START, END, at('2026-11-14T12:59:59+05:30')), { kind: 'live' });
    assert.deepEqual(countdownState(START, END, at(END)), { kind: 'ended' });
  });

  it('treats unreadable times as ended, so nothing wrong is shown', () => {
    assert.deepEqual(countdownState('soon', END, 0), { kind: 'ended' });
  });
});

describe('count-up', () => {
  it('starts at 0, rises quickly, and lands exactly on the target', () => {
    assert.equal(valueAt(350, 0), 0);
    assert.ok(valueAt(350, 0.5) > 175, 'ease-out: more than half way at half time');
    assert.equal(valueAt(350, 1), 350);
    assert.equal(valueAt(350, 1.4), 350);
  });

  it('never goes past the target on the way', () => {
    for (let t = 0; t <= 1; t += 0.01) assert.ok(valueAt(1360, t) <= 1360);
  });

  it('eases monotonically', () => {
    let last = -1;
    for (let t = 0; t <= 1; t += 0.05) {
      assert.ok(easeOutCubic(t) >= last);
      last = easeOutCubic(t);
    }
  });

  it('formats with Indian digit grouping', () => {
    assert.equal(formatCount(1360), '1,360');
    assert.equal(formatCount(100000), '1,00,000');
  });
});
