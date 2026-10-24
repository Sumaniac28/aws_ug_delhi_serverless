import { useMemo, useState, type ReactNode } from 'react';
import { ApiError, type CollectionName, type Doc, type ListItem } from '../lib/api.ts';
import { COLLECTIONS } from '../lib/collections.ts';
import { mediaUrl } from '../lib/media.ts';
import { isValidId, slugify } from '../lib/slug.ts';
import { validate, type FieldIssue } from '../lib/validation.ts';
import { useApp } from '../state/app.tsx';
import { usePublish } from '../state/publish.tsx';
import { Icon } from '../ui/icons.tsx';
import { Alert, Button, Modal } from '../ui/primitives.tsx';
import { useToast } from '../ui/toast.tsx';
import { FormProvider, useField, useForm } from './context.tsx';
import { CheckField, RefSelect, SelectField, TextField } from './fields.tsx';
import { MediaField } from './photos.tsx';

const nameOf = (i: Pick<ListItem, 'id'> & Record<string, unknown>) => String(i.name ?? i.title ?? i.id);
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/** A round photo, or the person's initials when there is no photo (yet). */
export function Avatar({ name, photo }: { name: string; photo?: unknown }) {
  const { config } = useApp();
  const [broken, setBroken] = useState(false);
  if (typeof photo === 'string' && photo && !broken) {
    return <img src={mediaUrl(config.siteUrl, photo, 480)} alt="" width={32} height={32} className="size-8 shrink-0 rounded-full border border-border bg-muted object-cover" onError={() => setBroken(true)} />;
  }
  return (
    <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-sm font-bold text-secondary-foreground">
      {initials(name) || '?'}
    </span>
  );
}

// ---- Creating something without leaving the page -----------------------------------------------------

const QUICK: Partial<Record<CollectionName, { singular: string; plural: string }>> = {
  speakers: { singular: 'speaker', plural: 'speakers' },
  organizers: { singular: 'host', plural: 'hosts' },
  sponsors: { singular: 'sponsor', plural: 'sponsors' },
};

function QuickFields({ collection }: { collection: CollectionName }) {
  if (collection === 'speakers') {
    return (
      <>
        <TextField path="name" label="Name" hint="Speakers are shown by name and photo only, never by job title." />
        <MediaField path="photo" label="Photo" />
        <TextField path="linkedin" label="LinkedIn" type="url" optional />
        <CheckField path="consent.publish" label="They agreed that we publish their photo and bio" hint="Without this the site shows only their name on the event, with no photo or page. You can change it later under Speakers." />
      </>
    );
  }
  if (collection === 'organizers') {
    return (
      <>
        <TextField path="name" label="Name" />
        <TextField path="role" label="Role" placeholder="Volunteer" />
        <MediaField path="photo" label="Photo" />
        <TextField path="linkedin" label="LinkedIn" type="url" optional />
      </>
    );
  }
  return (
    <>
      <TextField path="name" label="Name" />
      <TextField path="url" label="Website" type="url" />
      <SelectField path="defaultTier" label="Usual level" options={TIER_CHOICES} />
      <MediaField path="logo" label="Logo" />
    </>
  );
}

const TIER_CHOICES = [
  { value: 'title', label: 'Title sponsor' },
  { value: 'gold', label: 'Gold' },
  { value: 'silver', label: 'Silver' },
  { value: 'community', label: 'Community partner' },
  { value: 'venue', label: 'Venue partner' },
  { value: 'partner', label: 'Partner' },
];

/**
 * Adds a speaker, host or sponsor from inside another form, so nobody has to leave the event half-filled to create
 * the person first. It saves through the same API and the same rules as the full page, then hands back the new id.
 */
export function QuickCreateDialog({ collection, open, initialName = '', onClose, onCreated }: { collection: CollectionName; open: boolean; initialName?: string; onClose: () => void; onCreated: (id: string, name: string) => void }) {
  return (
    <Modal open={open} title={`Add a new ${QUICK[collection]?.singular ?? COLLECTIONS[collection].singular}`} onClose={onClose}>
      {/* Mounted only while open, so every opening starts with a clean form. */}
      <QuickCreateBody collection={collection} initialName={initialName} onClose={onClose} onCreated={onCreated} />
    </Modal>
  );
}

function QuickCreateBody({ collection, initialName, onClose, onCreated }: { collection: CollectionName; initialName: string; onClose: () => void; onCreated: (id: string, name: string) => void }) {
  const meta = COLLECTIONS[collection];
  const { api, endSession } = useApp();
  const { refresh } = usePublish();
  const toast = useToast();
  const [doc, setDoc] = useState<Doc>(() => ({ ...meta.emptyDoc(), name: initialName || undefined }));
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [serverIssues, setServerIssues] = useState<FieldIssue[]>([]);

  const id = slugify(String(doc.name ?? ''));
  const result = useMemo(() => validate(collection, doc), [collection, doc]);
  const issues = useMemo(() => [...(result.ok ? [] : result.issues), ...serverIssues], [result, serverIssues]);

  const create = async () => {
    setShowAll(true);
    if (!result.ok || !isValidId(id)) return;
    setSaving(true);
    setError(null);
    try {
      await api.create(collection, id, result.data);
      const name = String(result.data.name ?? id);
      toast(`Added “${name}”. It goes on the website with your next Publish.`);
      void refresh();
      onCreated(id, name);
      onClose();
    } catch (e: any) {
      if (e?.name === 'AuthError') return endSession();
      const err = e instanceof ApiError ? e : new ApiError(0, 'unknown', String(e?.message ?? e));
      setError(err);
      if (err.code === 'invalid_document' && Array.isArray(err.details)) setServerIssues(err.details as FieldIssue[]);
    } finally {
      setSaving(false);
    }
  };

  const singular = QUICK[collection]?.singular ?? meta.singular;
  return (
    <FormProvider
      doc={doc}
      onChange={(next) => (setDoc(next), setServerIssues([]), setError(null))}
      issues={issues}
      touched={touched}
      onTouch={(p) => setTouched((t) => new Set(t).add(p))}
      showAll={showAll}
      mediaFolder={isValidId(id) ? `${collection}/${id}` : null}
    >
      <div className="grid grid-cols-1 gap-5">
        <QuickFields collection={collection} />
        {error?.code === 'conflict' && (
          <Alert tone="warning" title={`There is already a ${singular} with this name.`}>
            Close this window and choose them from the list, or change the name a little (for example add a middle initial).
          </Alert>
        )}
        {error && error.code !== 'conflict' && <Alert tone="error" title="This could not be saved.">{error.message}</Alert>}
        <div className="flex flex-wrap justify-end gap-3">
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void create()} disabled={saving}>
            {saving ? 'Adding…' : `Add ${singular}`}
          </Button>
        </div>
      </div>
    </FormProvider>
  );
}

// ---- Picking several ---------------------------------------------------------------------------------

/**
 * Choose people for an event: type to search, press a name to add them, press the cross to take them off. When the
 * person does not exist yet, "New speaker" adds them right here.
 */
export function EntityPicker({
  path,
  label,
  hint,
  collection,
  options,
  reload,
  loading = false,
  compact = false,
}: {
  path: string;
  label: string;
  hint?: ReactNode;
  collection: 'speakers' | 'organizers';
  options: ListItem[];
  reload: () => void;
  /** The list is still arriving, so a name that is not in it yet is not "missing". */
  loading?: boolean;
  /** For many pickers on one page (one per session): the search box stays folded away until "Add" is pressed. */
  compact?: boolean;
}) {
  const form = useForm();
  const f = useField(path);
  const names = QUICK[collection]!;
  const [expanded, setExpanded] = useState(!compact);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState<string | null>(null);
  // People added a moment ago, before the list has caught up, so their chip never flashes as "missing".
  const [justAdded, setJustAdded] = useState<Record<string, string>>({});

  const selected = ((f.value as string[] | undefined) ?? []).filter(Boolean);
  const byId = new Map(options.map((o) => [o.id, o]));
  const available = options.filter((o) => !selected.includes(o.id)).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const q = query.trim().toLowerCase();
  const matches = q ? available.filter((o) => nameOf(o).toLowerCase().includes(q)) : available;
  const add = (id: string) => form.set(path, [...selected, id]);
  const remove = (id: string) => form.set(path, selected.filter((s) => s !== id));
  const searchId = `${f.id}-search`;

  return (
    <fieldset aria-describedby={f.error ? f.errorId : undefined} className="grid grid-cols-1 gap-3">
      <legend className="font-bold">{label}</legend>
      {hint && <p className="text-[0.8125rem] text-muted-foreground">{hint}</p>}

      {selected.length > 0 ? (
        <ul aria-label={`Chosen ${names.plural}`} className="flex flex-wrap gap-2">
          {selected.map((id) => {
            const item = byId.get(id);
            const known = item ?? (justAdded[id] ? { id, name: justAdded[id] } : loading ? { id, name: '…' } : undefined);
            const name = known ? nameOf(known as ListItem) : id;
            return (
              <li key={id} className={`inline-flex items-center gap-2 rounded-full border py-1 pr-1 pl-1.5 ${known ? 'border-border bg-card' : 'border-error text-error'}`}>
                <Avatar name={name} photo={item?.photo} />
                <span className="font-bold">{name}</span>
                {!known && <span className="text-sm">(no longer exists)</span>}
                <button type="button" aria-label={`Remove ${name}`} onClick={() => remove(id)} className="grid size-8 place-items-center rounded-full hover:bg-muted">
                  <Icon name="x" size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground">No {names.plural} chosen yet.</p>
      )}

      {!expanded && (
        <div>
          <Button className="min-h-8 px-3" aria-expanded={false} onClick={() => setExpanded(true)}>
            <Icon name="user-plus" size={16} />
            Add a {names.singular}
          </Button>
        </div>
      )}

      <div className={`grid gap-2 rounded-md border border-border p-3 ${expanded ? '' : 'hidden'}`}>
        <label htmlFor={searchId} className="font-bold">
          Find a {names.singular}
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
            <Icon name="search" size={18} />
          </span>
          <input id={searchId} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Start typing a name" autoComplete="off" className="block min-h-ctl w-full rounded-md border border-input bg-background py-2 pr-3 pl-10 focus-visible:ring-3 focus-visible:ring-outline/50" />
        </div>
        {options.length === 0 && <p className="text-muted-foreground">No {names.plural} have been added yet. Use “New {names.singular}” below.</p>}
        {matches.length > 0 && (
          <ul aria-label={`Matching ${names.plural}`} className="grid max-h-56 overflow-y-auto">
            {matches.map((o) => (
              <li key={o.id}>
                <button type="button" onClick={() => (add(o.id), setQuery(''))} className="flex min-h-ctl w-full items-center gap-3 rounded-md px-2 text-left hover:bg-muted" aria-label={`Add ${nameOf(o)}`}>
                  <Avatar name={nameOf(o)} photo={o.photo} />
                  <span className="flex-1">{nameOf(o)}</span>
                  <Icon name="plus" size={18} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {q && matches.length === 0 && options.length > 0 && <p className="text-muted-foreground">No {names.plural} match “{query.trim()}”.</p>}
        <div>
          <Button onClick={() => setCreating(query.trim())}>
            <Icon name="user-plus" size={18} />
            {q && matches.length === 0 ? `Add “${query.trim()}” as a new ${names.singular}` : `New ${names.singular}`}
          </Button>
        </div>
      </div>

      {f.error && (
        <p id={f.errorId} className="font-medium text-error">
          {f.error}
        </p>
      )}

      <QuickCreateDialog
        collection={collection}
        open={creating !== null}
        initialName={creating ?? ''}
        onClose={() => setCreating(null)}
        onCreated={(id, name) => {
          setJustAdded((j) => ({ ...j, [id]: name }));
          add(id);
          setQuery('');
          reload();
        }}
      />
    </fieldset>
  );
}

/** One sponsor, from a drop-down, with a way to add one that is not listed yet. */
export function SponsorSelect({ path, label, options, reload }: { path: string; label: string; options: ListItem[]; reload: () => void }) {
  const form = useForm();
  const [creating, setCreating] = useState(false);
  return (
    <div className="grid grid-cols-1 content-start gap-2">
      <RefSelect path={path} label={label} options={options} />
      <div>
        <Button className="min-h-8 px-3" onClick={() => setCreating(true)}>
          <Icon name="plus" size={16} />
          New sponsor
        </Button>
      </div>
      <QuickCreateDialog
        collection="sponsors"
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          form.set(path, id);
          reload();
        }}
      />
    </div>
  );
}

/** One organizer (an author), from a drop-down, with a way to add someone who is not listed yet. */
export function HostSelect({ path, label, options, reload }: { path: string; label: string; options: ListItem[]; reload: () => void }) {
  const form = useForm();
  const [creating, setCreating] = useState(false);
  return (
    <div className="grid grid-cols-1 content-start gap-2">
      <RefSelect path={path} label={label} options={options} />
      <div>
        <Button className="min-h-8 px-3" onClick={() => setCreating(true)}>
          <Icon name="plus" size={16} />
          New host
        </Button>
      </div>
      <QuickCreateDialog
        collection="organizers"
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          form.set(path, id);
          reload();
        }}
      />
    </div>
  );
}
