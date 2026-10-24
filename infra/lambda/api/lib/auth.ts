import { HttpError, type ApiEvent } from './http.ts';

export const ORGANIZERS_GROUP = 'organizers';

export interface Organizer {
  /** Cognito username; recorded as the editor of every change. */
  username: string;
  sub: string;
}

/** HTTP API passes array claims as a string such as "[organizers admins]". */
export function parseGroups(claim: unknown): string[] {
  if (Array.isArray(claim)) return claim.map(String);
  if (typeof claim !== 'string') return [];
  return claim.replace(/^\[|\]$/g, '').split(/[\s,]+/).filter(Boolean);
}

/**
 * Second line of defence behind the API Gateway JWT authorizer, which has already verified the token's
 * signature, issuer, expiry and client. A JWT authorizer cannot test group membership, so every handler
 * calls this first: the caller must hold an *access* token and belong to the organizers group.
 */
export function requireOrganizer(event: ApiEvent, group = ORGANIZERS_GROUP): Organizer {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) throw new HttpError(401, 'unauthenticated', 'Sign in to use the admin.');
  if (claims.token_use !== 'access') throw new HttpError(401, 'unauthenticated', 'Use the access token, not the ID token.');
  if (!parseGroups(claims['cognito:groups']).includes(group)) throw new HttpError(403, 'forbidden', 'Only organizers can use the admin.');

  const username = typeof claims.username === 'string' ? claims.username : undefined;
  const sub = typeof claims.sub === 'string' ? claims.sub : undefined;
  if (!username || !sub) throw new HttpError(401, 'unauthenticated', 'The token has no user identity.');
  return { username, sub };
}
