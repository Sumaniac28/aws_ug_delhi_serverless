/**
 * Validation in the browser uses the SAME Zod schema as the site build and the API
 * (../../../src/schema), so what the form accepts is exactly what the server will accept.
 * Zod's messages are written for developers; this turns them into plain English for organizers.
 */
import { eventSchema, organizerSchema, postSchema, speakerSchema, sponsorSchema } from '../../../src/schema/index.ts';
import type { CollectionName, Doc } from './api.ts';

const SCHEMAS = { events: eventSchema, speakers: speakerSchema, sponsors: sponsorSchema, organizers: organizerSchema, posts: postSchema };

export interface FieldIssue {
  /** Dotted path of the field, e.g. "agenda.2.title". Empty for a problem with the whole document. */
  path: string;
  message: string;
}

type ZodIssueLike = { code: string; path: PropertyKey[]; message: string; [k: string]: any };

const sentence = (s: string) => {
  const t = s.trim();
  const cap = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(cap) ? cap : `${cap}.`;
};

export function friendlyMessage(issue: ZodIssueLike): string {
  switch (issue.code) {
    case 'invalid_type':
      return /received undefined|received null/.test(issue.message) ? 'This is required.' : 'This is not the right kind of value.';
    case 'too_small':
      if (issue.origin === 'string' && issue.minimum === 1) return 'This is required.';
      if (issue.origin === 'string') return `Use at least ${issue.minimum} characters.`;
      if (issue.origin === 'number') return `Must be at least ${issue.minimum}.`;
      return 'This needs more entries.';
    case 'too_big':
      if (issue.origin === 'string') return `Keep this to ${issue.maximum} characters or fewer.`;
      if (issue.origin === 'number') return `Must be at most ${issue.maximum}.`;
      return 'This has too many entries.';
    case 'invalid_format':
      switch (issue.format) {
        case 'url':
          return 'Enter a full web address, starting with https://';
        case 'email':
          return 'Enter a valid email address.';
        case 'datetime':
          return 'Enter a valid date and time.';
        case 'date':
          return 'Enter a valid date.';
        default:
          return sentence(issue.message);
      }
    case 'invalid_value':
      return 'Choose one of the options.';
    case 'unrecognized_keys':
      return 'This field is not allowed.';
    default:
      // "custom" issues carry the schema's own sentence (e.g. "venue is required unless the event is online-only").
      return sentence(issue.message);
  }
}

export type ValidationResult = { ok: true; data: Doc } | { ok: false; issues: FieldIssue[] };

export function validate(collection: CollectionName, doc: Doc): ValidationResult {
  const result = SCHEMAS[collection].safeParse(doc);
  if (result.success) return { ok: true, data: result.data as Doc };
  return {
    ok: false,
    issues: (result.error.issues as ZodIssueLike[]).map((i) => ({ path: i.path.map(String).join('.'), message: friendlyMessage(i) })),
  };
}
