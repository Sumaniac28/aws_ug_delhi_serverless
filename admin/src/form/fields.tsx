import { useEffect, useRef, useState, type ReactNode } from 'react';
import { renderMarkdown } from '../../../src/lib/markdown.ts';
import type { ListItem } from '../lib/api.ts';
import { fromInput, toInput } from '../lib/ist.ts';
import { mediaUrl } from '../lib/media.ts';
import { append, getIn, move, removeAt } from '../lib/path.ts';
import { useApp } from '../state/app.tsx';
import { Button } from '../ui/primitives.tsx';
import { useField, useForm } from './context.tsx';

// ---- Shared pieces -------------------------------------------------------------------------------

const control =
  'block w-full min-h-11 rounded-md border bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-outline/50';
const controlBorder = (error?: string) => (error ? 'border-error' : 'border-input');

interface Common {
  path: string;
  label: string;
  hint?: ReactNode;
  /** Shown as "(optional)". Required fields carry no marker, which keeps long forms calm. */
  optional?: boolean;
}

function Shell({ id, label, hint, hintId, error, errorId, optional, children, inline }: { id: string; label: string; hint?: ReactNode; hintId: string; error?: string; errorId: string; optional?: boolean; children: ReactNode; inline?: boolean }) {
  return (
    <div className={inline ? '' : 'grid gap-1.5'}>
      <label htmlFor={id} className="font-bold">
        {label} {optional && <span className="font-normal text-muted-foreground">(optional)</span>}
      </label>
      {hint && (
        <p id={hintId} className="text-[0.9375rem] text-muted-foreground">
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p id={errorId} className="font-medium text-error">
          {error}
        </p>
      )}
    </div>
  );
}

const describedBy = (f: { hintId: string; errorId: string; error?: string }, hint: unknown) => [hint ? f.hintId : '', f.error ? f.errorId : ''].filter(Boolean).join(' ') || undefined;

// ---- Text ----------------------------------------------------------------------------------------

export function TextField({ path, label, hint, optional, type = 'text', placeholder, maxLength, counter }: Common & { type?: 'text' | 'url' | 'email' | 'date'; placeholder?: string; maxLength?: number; counter?: number }) {
  const f = useField(path);
  const value = (f.value as string | undefined) ?? '';
  return (
    <Shell {...f} label={label} hint={hint} optional={optional}>
      <input
        id={f.id}
        type={type}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => f.set(e.target.value === '' ? undefined : e.target.value)}
        onBlur={f.blur}
        aria-invalid={!!f.error}
        aria-describedby={describedBy(f, hint)}
        className={`${control} ${controlBorder(f.error)}`}
      />
      {counter !== undefined && (
        <p className={`text-[0.9375rem] ${value.length > counter ? 'font-bold text-error' : 'text-muted-foreground'}`} aria-live="polite">
          {value.length} of {counter} characters
        </p>
      )}
    </Shell>
  );
}

export function TextArea({ path, label, hint, optional, rows = 4 }: Common & { rows?: number }) {
  const f = useField(path);
  return (
    <Shell {...f} label={label} hint={hint} optional={optional}>
      <textarea
        id={f.id}
        rows={rows}
        value={(f.value as string | undefined) ?? ''}
        onChange={(e) => f.set(e.target.value === '' ? undefined : e.target.value)}
        onBlur={f.blur}
        aria-invalid={!!f.error}
        aria-describedby={describedBy(f, hint)}
        className={`${control} ${controlBorder(f.error)}`}
      />
    </Shell>
  );
}

/** Text with a Markdown preview, rendered by the same library as the site (raw HTML is disabled there too). */
export function MarkdownField({ path, label, hint, optional, rows = 10 }: Common & { rows?: number }) {
  const f = useField(path);
  const [preview, setPreview] = useState(false);
  const value = (f.value as string | undefined) ?? '';
  return (
    <Shell {...f} label={label} hint={hint ?? 'Formatting: **bold**, *italic*, - bullet lists, ## headings, [text](https://link).'} optional={optional}>
      {preview ? (
        <div className="prose-md min-h-24 rounded-md border border-border p-4" aria-label={`${label} preview`} dangerouslySetInnerHTML={{ __html: renderMarkdown(value) || '<p>Nothing to preview yet.</p>' }} />
      ) : (
        <textarea
          id={f.id}
          rows={rows}
          value={value}
          onChange={(e) => f.set(e.target.value === '' ? undefined : e.target.value)}
          onBlur={f.blur}
          aria-invalid={!!f.error}
          aria-describedby={describedBy(f, true)}
          className={`${control} font-mono ${controlBorder(f.error)}`}
        />
      )}
      <div>
        <Button variant="ghost" className="min-h-9 px-3" onClick={() => setPreview((p) => !p)} aria-pressed={preview}>
          {preview ? 'Back to editing' : 'Preview'}
        </Button>
      </div>
    </Shell>
  );
}

export function NumberField({ path, label, hint, optional = true, min = 0 }: Common & { min?: number }) {
  const f = useField(path);
  return (
    <Shell {...f} label={label} hint={hint} optional={optional}>
      <input
        id={f.id}
        type="number"
        inputMode="numeric"
        min={min}
        value={(f.value as number | undefined) ?? ''}
        onChange={(e) => f.set(e.target.value === '' ? undefined : Number(e.target.value))}
        onBlur={f.blur}
        aria-invalid={!!f.error}
        aria-describedby={describedBy(f, hint)}
        className={`${control} ${controlBorder(f.error)}`}
      />
    </Shell>
  );
}

/** A date and time in Indian Standard Time, stored with an explicit +05:30 offset. */
export function DateTimeField({ path, label, hint, optional }: Common) {
  const f = useField(path);
  return (
    <Shell {...f} label={label} hint={hint ?? 'India time (IST).'} optional={optional}>
      <input
        id={f.id}
        type="datetime-local"
        value={toInput(f.value as string | undefined)}
        onChange={(e) => f.set(fromInput(e.target.value) || undefined)}
        onBlur={f.blur}
        aria-invalid={!!f.error}
        aria-describedby={describedBy(f, true)}
        className={`${control} ${controlBorder(f.error)}`}
      />
    </Shell>
  );
}

// ---- Choices -------------------------------------------------------------------------------------

export function SelectField({ path, label, hint, optional, options, placeholder = 'Choose…' }: Common & { options: { value: string; label: string }[]; placeholder?: string }) {
  const f = useField(path);
  return (
    <Shell {...f} label={label} hint={hint} optional={optional}>
      <select
        id={f.id}
        value={(f.value as string | undefined) ?? ''}
        onChange={(e) => f.set(e.target.value === '' ? undefined : e.target.value)}
        onBlur={f.blur}
        aria-invalid={!!f.error}
        aria-describedby={describedBy(f, hint)}
        className={`${control} ${controlBorder(f.error)}`}
      >
        {(f.value === undefined || optional) && <option value="">{optional ? 'None' : placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Shell>
  );
}

export function CheckField({ path, label, hint }: Omit<Common, 'optional'>) {
  const f = useField(path);
  return (
    <div className="grid gap-1">
      <label className="flex min-h-11 items-start gap-3 font-bold">
        <input id={f.id} type="checkbox" checked={f.value === true} onChange={(e) => f.set(e.target.checked)} onBlur={f.blur} aria-describedby={hint ? f.hintId : undefined} className="mt-1.5 size-5 accent-[var(--primary-accent)]" />
        <span>{label}</span>
      </label>
      {hint && (
        <p id={f.hintId} className="pl-8 text-[0.9375rem] text-muted-foreground">
          {hint}
        </p>
      )}
      {f.error && <p className="pl-8 font-medium text-error">{f.error}</p>}
    </div>
  );
}

/** Pick several items from another collection (speakers for an event, tags of organizers...). */
export function RefPicker({ path, label, hint, options, empty }: Omit<Common, 'optional'> & { options: ListItem[]; empty?: string; titleOf?: (i: ListItem) => string }) {
  const form = useForm();
  const f = useField(path);
  const selected = ((f.value as string[] | undefined) ?? []).filter(Boolean);
  const labelOf = (i: ListItem) => String(i.name ?? i.title ?? i.id);
  const known = new Set(options.map((o) => o.id));
  const stale = selected.filter((id) => !known.has(id));
  const toggle = (id: string, on: boolean) => form.set(path, on ? [...selected, id] : selected.filter((s) => s !== id));

  return (
    <fieldset aria-describedby={f.error ? f.errorId : undefined} className="grid gap-1.5">
      <legend className="font-bold">{label}</legend>
      {hint && <p className="text-[0.9375rem] text-muted-foreground">{hint}</p>}
      {options.length === 0 && <p className="text-muted-foreground">{empty ?? 'Nothing to choose from yet.'}</p>}
      <div className="grid gap-x-6 sm:grid-cols-2">
        {options.map((o) => (
          <label key={o.id} className="flex min-h-11 items-center gap-3">
            <input type="checkbox" checked={selected.includes(o.id)} onChange={(e) => toggle(o.id, e.target.checked)} className="size-5 accent-[var(--primary-accent)]" />
            <span>{labelOf(o)}</span>
          </label>
        ))}
        {stale.map((id) => (
          <label key={id} className="flex min-h-11 items-center gap-3 text-error">
            <input type="checkbox" checked onChange={() => toggle(id, false)} className="size-5" />
            <span>{id} (no longer exists: untick to remove)</span>
          </label>
        ))}
      </div>
      {f.error && (
        <p id={f.errorId} className="font-medium text-error">
          {f.error}
        </p>
      )}
    </fieldset>
  );
}

/** One item from another collection, as a drop-down. */
export function RefSelect({ path, label, hint, optional, options }: Common & { options: ListItem[] }) {
  return <SelectField path={path} label={label} hint={hint} optional={optional} options={options.map((o) => ({ value: o.id, label: String(o.name ?? o.title ?? o.id) }))} />;
}

// ---- Lists ---------------------------------------------------------------------------------------

export function StringListField({ path, label, hint, addLabel = 'Add another', placeholder }: Omit<Common, 'optional'> & { addLabel?: string; placeholder?: string }) {
  const form = useForm();
  const items = (getIn(form.doc, path) as string[] | undefined) ?? [];
  return (
    <fieldset className="grid gap-2">
      <legend className="font-bold">{label}</legend>
      {hint && <p className="text-[0.9375rem] text-muted-foreground">{hint}</p>}
      {items.map((_, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="flex-1">
            <TextField path={`${path}.${i}`} label={`${label}, item ${i + 1}`} placeholder={placeholder} />
          </div>
          <Button variant="ghost" className="mt-8" aria-label={`Remove ${label} item ${i + 1}`} onClick={() => form.update((d) => removeAt(d, path, i))}>
            Remove
          </Button>
        </div>
      ))}
      <div>
        <Button onClick={() => form.update((d) => append(d, path, ''))}>{addLabel}</Button>
      </div>
    </fieldset>
  );
}

/** A repeatable group of fields: agenda sessions, FAQs, registration links... */
export function RepeatField({
  path,
  label,
  itemLabel,
  addLabel,
  empty,
  children,
  hint,
}: {
  path: string;
  label: string;
  itemLabel: string;
  addLabel: string;
  empty: () => unknown;
  hint?: ReactNode;
  children: (itemPath: string, index: number) => ReactNode;
}) {
  const form = useForm();
  const items = (getIn(form.doc, path) as unknown[] | undefined) ?? [];
  const groupErrors = form.errorsUnder(path).filter((e) => e.path === path);
  return (
    <fieldset className="grid gap-4">
      <legend className="text-2xl font-bold [font-stretch:82%] font-display">{label}</legend>
      {hint && <p className="-mt-2 text-[0.9375rem] text-muted-foreground">{hint}</p>}
      {groupErrors.map((e) => (
        <p key={e.message} className="font-medium text-error">
          {e.message}
        </p>
      ))}
      {items.length === 0 && <p className="text-muted-foreground">None yet.</p>}
      {items.map((_, i) => (
        <div key={i} role="group" aria-label={`${itemLabel} ${i + 1}`} className="grid gap-4 rounded-md border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-bold">
              {itemLabel} {i + 1}
            </p>
            <div className="flex flex-wrap gap-1">
              <Button variant="ghost" className="min-h-9 px-3" disabled={i === 0} aria-label={`Move ${itemLabel} ${i + 1} up`} onClick={() => form.update((d) => move(d, path, i, i - 1))}>
                Move up
              </Button>
              <Button variant="ghost" className="min-h-9 px-3" disabled={i === items.length - 1} aria-label={`Move ${itemLabel} ${i + 1} down`} onClick={() => form.update((d) => move(d, path, i, i + 1))}>
                Move down
              </Button>
              <Button variant="ghost" className="min-h-9 px-3" aria-label={`Remove ${itemLabel} ${i + 1}`} onClick={() => form.update((d) => removeAt(d, path, i))}>
                Remove
              </Button>
            </div>
          </div>
          {children(`${path}.${i}`, i)}
        </div>
      ))}
      <div>
        <Button onClick={() => form.update((d) => append(d, path, empty()))}>{addLabel}</Button>
      </div>
    </fieldset>
  );
}

/** A titled group of related fields, with a count of problems inside it. */
export function Section({ title, hint, children, errorPrefix }: { title: string; hint?: ReactNode; children: ReactNode; errorPrefix?: string }) {
  const form = useForm();
  const groupErrors = errorPrefix ? form.errorsUnder(errorPrefix).filter((e) => e.path === errorPrefix) : [];
  return (
    <section className="grid gap-5 border-t border-border py-8 first:border-t-0 first:pt-0">
      <div>
        <h2 className="text-3xl">{title}</h2>
        {hint && <p className="mt-1 text-muted-foreground">{hint}</p>}
        {groupErrors.map((e) => (
          <p key={e.message} className="mt-1 font-medium text-error">
            {e.message}
          </p>
        ))}
      </div>
      {children}
    </section>
  );
}

// ---- Photos --------------------------------------------------------------------------------------

const EXT_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', tif: 'image/tiff', tiff: 'image/tiff' };

type MediaState = { kind: 'idle' } | { kind: 'uploading' } | { kind: 'processing' } | { kind: 'ready' } | { kind: 'error'; message: string };

/** Resolves true once the image can be loaded, polling while the resize function works. */
function waitForImage(url: string, tries = 30, delayMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    let n = 0;
    const attempt = () => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => (++n >= tries ? resolve(false) : setTimeout(attempt, delayMs));
      img.src = `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
    };
    attempt();
  });
}

/** Upload a photo straight to S3 (a signed link from the API), then show it once it has been processed. */
export function MediaField({ path, label, hint, optional = true }: Common) {
  const { api, config } = useApp();
  const form = useForm();
  const f = useField(path);
  const key = f.value as string | undefined;
  const [state, setState] = useState<MediaState>({ kind: 'idle' });
  const [local, setLocal] = useState<string | undefined>();
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    const ext = file.name.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase() ?? '';
    if (!EXT_TYPES[ext]) {
      setState({ kind: 'error', message: /^hei[cf]$/.test(ext) ? 'iPhone HEIC photos are not supported. Export the photo as JPEG and try again.' : 'Choose a JPEG, PNG, WebP, AVIF, GIF or TIFF image.' });
      return;
    }
    if (!form.mediaFolder) {
      setState({ kind: 'error', message: 'Give this item a name first, then add the photo.' });
      return;
    }
    setState({ kind: 'uploading' });
    try {
      const signed = await api.signUpload({ folder: form.mediaFolder, filename: file.name, contentType: file.type || EXT_TYPES[ext]! });
      await api.uploadFile(signed, file);
      if (!alive.current) return;
      setLocal(URL.createObjectURL(file));
      f.set(signed.mediaKey);
      setState({ kind: 'processing' });
      const ok = await waitForImage(mediaUrl(config.siteUrl, signed.mediaKey));
      if (alive.current) setState(ok ? { kind: 'ready' } : { kind: 'error', message: 'The photo uploaded but is taking a while to process. It will appear on the site shortly.' });
    } catch (e: any) {
      if (alive.current) setState({ kind: 'error', message: e?.message ?? 'The upload failed. Try again.' });
    }
  };

  const busy = state.kind === 'uploading' || state.kind === 'processing';
  return (
    <div className="grid gap-1.5">
      <p className="font-bold" id={`${f.id}-label`}>
        {label} {optional && <span className="font-normal text-muted-foreground">(optional)</span>}
      </p>
      {hint && <p className="text-[0.9375rem] text-muted-foreground">{hint}</p>}
      <div className="flex flex-wrap items-center gap-4">
        {key && (
          <img
            src={local ?? mediaUrl(config.siteUrl, key)}
            alt={`Current ${label.toLowerCase()}`}
            className="h-24 w-40 rounded-md border border-border bg-muted object-cover"
            onError={(e) => ((e.currentTarget.style.visibility = 'hidden'), undefined)}
          />
        )}
        <div className="grid gap-2">
          <input ref={input} id={f.id} type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/tiff" className="visually-hidden" aria-labelledby={`${f.id}-label`} onChange={(e) => void choose(e.target.files?.[0])} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => input.current?.click()} disabled={busy}>
              {key ? 'Replace photo' : 'Choose photo'}
            </Button>
            {key && (
              <Button variant="ghost" onClick={() => (f.set(undefined), setLocal(undefined), setState({ kind: 'idle' }))} disabled={busy}>
                Remove
              </Button>
            )}
          </div>
          <p role="status" className="text-[0.9375rem] text-muted-foreground">
            {state.kind === 'uploading' && 'Uploading…'}
            {state.kind === 'processing' && 'Uploaded. Resizing for the site…'}
            {state.kind === 'ready' && 'Ready.'}
          </p>
        </div>
      </div>
      {state.kind === 'error' && (
        <p role="alert" className="font-medium text-error">
          {state.message}
        </p>
      )}
      {f.error && <p className="font-medium text-error">{f.error}</p>}
    </div>
  );
}
