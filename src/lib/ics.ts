import type { EventView } from './content';
import { icsStamp } from './time';

// RFC 5545: escape \ ; , and newlines in text values; fold lines at 75 octets.
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

function fold(line: string) {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ' ' + rest.slice(74);
  }
  out.push(rest);
  return out.join('\r\n');
}

export function buildIcs(ev: EventView, pageUrl: string) {
  const { data } = ev;
  const v = data.venue;
  const where = v ? [v.name, v.streetAddress, v.locality, v.region, v.postalCode].join(', ') : 'Online (join link is emailed to registered attendees)';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AWS UG Delhi NCR//Website//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${ev.id}@awsug-delhi-ncr`,
    `DTSTAMP:${icsStamp(Date.now())}`,
    `DTSTART:${icsStamp(data.start)}`,
    `DTEND:${icsStamp(data.end)}`,
    `SUMMARY:${esc(data.title)}`,
    `DESCRIPTION:${esc(`${data.summary}\n${pageUrl}`)}`,
    `LOCATION:${esc(where)}`,
    `URL:${pageUrl}`,
    `STATUS:${data.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
