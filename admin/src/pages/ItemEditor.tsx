import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useBlocker, useNavigate } from 'react-router';
import { FormProvider } from '../form/context.tsx';
import { ApiError, type CollectionName, type Doc, type Warning } from '../lib/api.ts';
import { COLLECTIONS } from '../lib/collections.ts';
import { formatIst } from '../lib/ist.ts';
import { isValidId, slugify } from '../lib/slug.ts';
import { validate, type FieldIssue } from '../lib/validation.ts';
import { useApp } from '../state/app.tsx';
import { useAsync } from '../state/hooks.ts';
import { Alert, Button, ConfirmDialog, PageHeading, Spinner } from '../ui/primitives.tsx';
import { useToast } from '../ui/toast.tsx';
import { EventForm, OrganizerForm, PostForm, SpeakerForm, SponsorForm } from './editors/forms.tsx';

const FORMS: Record<CollectionName, ComponentType> = { events: EventForm, speakers: SpeakerForm, sponsors: SponsorForm, organizers: OrganizerForm, posts: PostForm };

/** "registrationLinks.0.url" -> "Registration links, item 1, url" */
export function humanPath(path: string): string {
  if (!path) return 'This item';
  const words = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  const parts = path.split('.');
  const out: string[] = [];
  parts.forEach((p, i) => out.push(/^\d+$/.test(p) ? `item ${Number(p) + 1}` : i === 0 ? words(p).replace(/^./, (c) => c.toUpperCase()) : words(p)));
  return out.join(', ');
}

export function ItemEditor({ collection, id }: { collection: CollectionName; id?: string }) {
  const meta = COLLECTIONS[collection];
  const isNew = id === undefined;
  const { api, endSession } = useApp();
  const navigate = useNavigate();
  const toast = useToast();
  const loaded = useAsync(() => (isNew ? Promise.resolve(null) : api.get(collection, id!)), `${collection}/${id ?? 'new'}`);

  if (loaded.loading && !loaded.data && !loaded.error) return <Spinner label={`Loading ${meta.singular}`} />;
  if (loaded.error) {
    return (
      <Alert tone="error" title={loaded.error.status === 404 ? `That ${meta.singular} does not exist.` : `Could not load the ${meta.singular}.`} actions={loaded.error.status === 404 ? undefined : <Button onClick={loaded.reload}>Try again</Button>}>
        {loaded.error.message}
      </Alert>
    );
  }
  // Remount the form when a different item (or a reload after a conflict) arrives, so its state starts clean.
  const version = loaded.data?.etag ?? 'new';
  return <EditorBody key={`${collection}/${id ?? 'new'}/${version}`} collection={collection} id={id} initial={loaded.data ?? null} api={api} navigate={navigate} toast={toast} endSession={endSession} reload={loaded.reload} />;
}

interface BodyProps {
  collection: CollectionName;
  id: string | undefined;
  initial: { etag: string; data: Doc; lastModified?: string; editor?: string } | null;
  api: ReturnType<typeof useApp>['api'];
  navigate: ReturnType<typeof useNavigate>;
  toast: (m: string) => void;
  endSession: () => void;
  reload: () => void;
}

function EditorBody({ collection, id, initial, api, navigate, toast, endSession, reload }: BodyProps) {
  const meta = COLLECTIONS[collection];
  const isNew = id === undefined;
  const Form = FORMS[collection];

  const [doc, setDoc] = useState<Doc>(() => initial?.data ?? meta.emptyDoc());
  const [saved, setSaved] = useState<string>(() => JSON.stringify(initial?.data ?? meta.emptyDoc()));
  const [etag, setEtag] = useState(initial?.etag);
  const [newId, setNewId] = useState('');
  const [idTouched, setIdTouched] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [serverIssues, setServerIssues] = useState<FieldIssue[]>([]);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const summary = useRef<HTMLDivElement>(null);
  // Set just before our own navigation (after create or delete), when React has not yet re-rendered the clean state.
  const allowLeave = useRef(false);

  // The id of a new item follows its title/name until the organizer types their own.
  const suggested = slugify(String(doc[meta.idSource] ?? ''));
  const effectiveId = isNew ? (idTouched ? newId : suggested) : id!;
  const idOk = isValidId(effectiveId);

  const dirty = JSON.stringify(doc) !== saved;
  const result = useMemo(() => validate(collection, doc), [collection, doc]);
  const issues = useMemo(() => [...(result.ok ? [] : result.issues), ...serverIssues], [result, serverIssues]);

  const touch = useCallback((path: string) => setTouched((t) => (t.has(path) ? t : new Set(t).add(path))), []);
  const onChange = useCallback((next: Doc) => {
    setDoc(next);
    setServerIssues([]);
    setWarnings([]);
    setError(null);
  }, []);

  // Warn before losing edits: in-app navigation and closing the tab.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !saving && !allowLeave.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const handleApiError = (e: any) => {
    if (e?.name === 'AuthError') return endSession();
    const err = e instanceof ApiError ? e : new ApiError(0, 'unknown', String(e?.message ?? e));
    setError(err);
    if (err.code === 'invalid_document' && Array.isArray(err.details)) setServerIssues(err.details as FieldIssue[]);
  };

  const save = async () => {
    setShowAll(true);
    if (!result.ok || (isNew && !idOk)) {
      requestAnimationFrame(() => summary.current?.focus());
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        const created = await api.create(collection, effectiveId, result.data);
        // This page is replaced by the new item's, so a warning has to ride along in the message.
        toast(`Saved. “${meta.titleOf({ id: effectiveId, ...result.data })}” is created.${created.warnings.map((w) => ` ${w.message}`).join('')}`);
        setSaved(JSON.stringify(result.data));
        setDoc(result.data);
        // Re-open it as an existing item (fresh ETag).
        allowLeave.current = true;
        navigate(`/c/${collection}/${effectiveId}`, { replace: true });
      } else {
        const r = await api.update(collection, id!, result.data, etag!);
        setEtag(r.etag);
        setSaved(JSON.stringify(result.data));
        setDoc(result.data);
        setWarnings(r.warnings);
        toast(r.warnings.length ? 'Saved, with a note.' : 'Saved.');
      }
    } catch (e) {
      handleApiError(e);
      requestAnimationFrame(() => summary.current?.focus());
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      const removed = await api.remove(collection, id!, etag);
      setSaved(JSON.stringify(doc)); // nothing left to lose
      toast(`Deleted “${meta.titleOf({ id: id!, ...doc })}”. It can be restored from the version history if needed.${removed.warnings.map((w) => ` ${w.message}`).join('')}`);
      allowLeave.current = true;
      navigate(`/c/${collection}`);
    } catch (e) {
      setConfirmDelete(false);
      handleApiError(e);
      requestAnimationFrame(() => summary.current?.focus());
    } finally {
      setDeleting(false);
    }
  };

  const title = isNew ? `New ${meta.singular}` : meta.titleOf({ id: id!, ...doc });
  const shownIssues = showAll ? issues : [];

  return (
    <>
      <PageHeading title={title} lead={!isNew && initial?.lastModified ? `Last saved ${formatIst(initial.lastModified)} IST${initial.editor ? ` by ${initial.editor}` : ''}.` : undefined} />

      <div ref={summary} tabIndex={-1} className="mb-6 grid gap-4 outline-none">
        {warnings.map((w) => (
          <Alert key={w.code} tone="warning" title="Saved, with a note.">
            {w.message}
          </Alert>
        ))}
        {error?.isConflict && (
          <Alert tone="warning" title="Someone else saved this while you were editing." actions={<Button onClick={reload}>Load the latest version</Button>}>
            Loading it replaces what you have on screen, so copy anything you want to keep first.
          </Alert>
        )}
        {error && !error.isConflict && <Alert tone="error" title={error.code === 'in_use' ? 'This cannot be deleted yet.' : 'This could not be saved.'}>{error.message}</Alert>}
        {showAll && !error && (isNew && !idOk) && <Alert tone="error">Give this {meta.singular} a name so it has a web address.</Alert>}
        {shownIssues.length > 0 && (
          <Alert tone="error" title={`${shownIssues.length} ${shownIssues.length === 1 ? 'thing needs' : 'things need'} fixing before this can be saved.`}>
            <ul className="list-disc pl-5">
              {shownIssues.slice(0, 10).map((i) => (
                <li key={`${i.path}:${i.message}`}>
                  {i.path ? (
                    <a className="link" href={`#f-${i.path.replace(/\./g, '-')}`}>
                      {humanPath(i.path)}
                    </a>
                  ) : (
                    <strong>This item</strong>
                  )}
                  : {i.message}
                </li>
              ))}
            </ul>
          </Alert>
        )}
      </div>

      <FormProvider doc={doc} onChange={onChange} issues={issues} touched={touched} onTouch={touch} showAll={showAll} mediaFolder={idOk ? `${collection}/${effectiveId}` : null}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          noValidate
          className="grid gap-8"
        >
          {isNew ? (
            <div className="grid gap-1.5">
              <label htmlFor="item-id" className="font-bold">
                Web address name
              </label>
              <p className="text-[0.9375rem] text-muted-foreground">Part of the page address, so it cannot be changed later. Letters, numbers and hyphens.</p>
              <input
                id="item-id"
                value={effectiveId}
                onChange={(e) => {
                  setIdTouched(true);
                  setNewId(e.target.value);
                }}
                aria-invalid={showAll && !idOk}
                className="block min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 font-mono focus-visible:ring-3 focus-visible:ring-outline/50"
              />
              {effectiveId !== '' && !idOk && <p className="font-medium text-error">Use lowercase letters, numbers and single hyphens only.</p>}
            </div>
          ) : (
            <p className="text-muted-foreground">
              Web address name: <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-foreground">{id}</code>
            </p>
          )}

          <Form />

          <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background px-4 py-3">
            <p role="status" className="text-muted-foreground">
              {saving ? 'Saving…' : dirty ? 'You have unsaved changes.' : isNew ? '' : 'All changes saved.'}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {!isNew && (
                <Button variant="ghost" onClick={() => setConfirmDelete(true)} disabled={saving}>
                  Delete {meta.singular}
                </Button>
              )}
              <Button variant="primary" type="submit" disabled={saving || (!isNew && !dirty)}>
                {saving ? 'Saving…' : isNew ? `Create ${meta.singular}` : 'Save changes'}
              </Button>
            </div>
          </div>
        </form>
      </FormProvider>

      <ConfirmDialog open={confirmDelete} title={`Delete this ${meta.singular}?`} confirmLabel={`Delete ${meta.singular}`} busy={deleting} onConfirm={() => void remove()} onCancel={() => setConfirmDelete(false)}>
        <p>
          “{title}” will be removed from the site the next time you publish. Earlier versions are kept, so a tech volunteer can restore it.
        </p>
      </ConfirmDialog>

      <ConfirmDialog open={blocker.state === 'blocked'} title="Leave without saving?" confirmLabel="Leave and lose changes" onConfirm={() => blocker.proceed?.()} onCancel={() => blocker.reset?.()}>
        <p>You have unsaved changes to this {meta.singular}. If you leave now they will be lost.</p>
      </ConfirmDialog>
    </>
  );
}
