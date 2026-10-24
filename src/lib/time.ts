/** All display is in Asia/Kolkata; India has no DST, so IST is always exactly +05:30. */
const TZ = 'Asia/Kolkata';

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-IN', { timeZone: TZ, ...opts });

const dateLong = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const dateShort = fmt({ day: 'numeric', month: 'short', year: 'numeric' });
const timeOnly = fmt({ hour: 'numeric', minute: '2-digit', hour12: true });
const dayKey = fmt({ year: 'numeric', month: '2-digit', day: '2-digit' });
const monthShort = fmt({ month: 'short' });
const dayNum = fmt({ day: 'numeric' });
const yearOnly = fmt({ year: 'numeric' });

const d = (iso: string) => new Date(iso);

export const formatDateLong = (iso: string) => dateLong.format(d(iso));
export const formatDateShort = (iso: string) => dateShort.format(d(iso));
export const formatTime = (iso: string) => timeOnly.format(d(iso)).replace(/\s?(am|pm)/i, (_, m) => ` ${m.toUpperCase()}`);
export const formatTimeRange = (start: string, end: string) => `${formatTime(start)} to ${formatTime(end)} IST`;
export const monthOf = (iso: string) => monthShort.format(d(iso)).toUpperCase();
export const dayOf = (iso: string) => dayNum.format(d(iso));
export const yearOf = (iso: string) => yearOnly.format(d(iso));

/** yyyy-mm-dd of the instant, as seen in IST. Sortable and comparable. */
export const istDateKey = (iso: string | number | Date) => {
  const parts = dayKey.formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
};

/** Compact UTC form used by iCalendar: 20261114T103000Z */
export const icsStamp = (iso: string | number | Date) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
