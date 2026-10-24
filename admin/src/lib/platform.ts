/** Which ticketing site a pasted link belongs to, so the organizer does not have to say. Undefined when unsure. */
export function detectPlatform(url: string | undefined): 'konfhub' | 'meetup' | 'luma' | undefined {
  if (!url) return undefined;
  let host = '';
  try {
    host = new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  const is = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  if (is('meetup.com')) return 'meetup';
  if (is('lu.ma') || is('luma.com')) return 'luma';
  if (is('konfhub.com')) return 'konfhub';
  return undefined;
}
