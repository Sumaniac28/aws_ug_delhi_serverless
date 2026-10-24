import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import type { Doc } from '../lib/api.ts';
import { getIn, setIn } from '../lib/path.ts';
import type { FieldIssue } from '../lib/validation.ts';

export interface FormApi {
  doc: Doc;
  /** Sets one field. Undefined removes it, so an emptied optional field leaves no "" in the JSON. */
  set: (path: string, value: unknown) => void;
  /** Applies a change to the whole document (add, remove or reorder list items). */
  update: (fn: (doc: Doc) => Doc) => void;
  blur: (path: string) => void;
  /** The error for exactly this field, once it has been touched or a save was attempted. */
  error: (path: string) => string | undefined;
  /** Errors anywhere under a path, e.g. everything inside "venue". */
  errorsUnder: (prefix: string) => FieldIssue[];
  /** Folder photos are uploaded into (e.g. "events/meetup-13"), or null until the item has an id. */
  mediaFolder: string | null;
}

const FormContext = createContext<FormApi | null>(null);

export function useForm(): FormApi {
  const v = useContext(FormContext);
  if (!v) throw new Error('Form fields must be inside <FormProvider>');
  return v;
}

export interface FormProviderProps {
  doc: Doc;
  onChange: (doc: Doc) => void;
  issues: FieldIssue[];
  touched: ReadonlySet<string>;
  onTouch: (path: string) => void;
  /** After a save attempt every error is shown, not just those of fields the user has visited. */
  showAll: boolean;
  mediaFolder: string | null;
  children: ReactNode;
}

export function FormProvider({ doc, onChange, issues, touched, onTouch, showAll, mediaFolder, children }: FormProviderProps) {
  const set = useCallback((path: string, value: unknown) => onChange(setIn(doc, path, value)), [doc, onChange]);
  const update = useCallback((fn: (d: Doc) => Doc) => onChange(fn(doc)), [doc, onChange]);

  const shown = useCallback((path: string) => showAll || touched.has(path), [showAll, touched]);
  const api = useMemo<FormApi>(
    () => ({
      doc,
      set,
      update,
      blur: onTouch,
      mediaFolder,
      error: (path) => (shown(path) ? issues.find((i) => i.path === path)?.message : undefined),
      errorsUnder: (prefix) => issues.filter((i) => (i.path === prefix || i.path.startsWith(`${prefix}.`)) && (showAll || touched.has(i.path))),
    }),
    [doc, set, update, onTouch, mediaFolder, shown, issues, showAll, touched],
  );
  return <FormContext.Provider value={api}>{children}</FormContext.Provider>;
}

/** Stable DOM ids for a field and its hint and error text. */
export function useField(path: string) {
  const form = useForm();
  const id = `f-${path.replace(/\./g, '-')}`;
  return {
    id,
    hintId: `${id}-hint`,
    errorId: `${id}-error`,
    value: getIn(form.doc, path),
    error: form.error(path),
    set: (v: unknown) => form.set(path, v),
    blur: () => form.blur(path),
  };
}
