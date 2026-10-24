import { useEffect, useRef, useState, type ReactNode } from 'react';
import { renderMarkdown } from '../../../src/lib/markdown.ts';
import type { ListItem } from '../lib/api.ts';
import { fromInput, toInput } from '../lib/ist.ts';
import { append, getIn, move, removeAt } from '../lib/path.ts';
import { Icon } from '../ui/icons.tsx';
import { Button } from '../ui/primitives.tsx';
import { useField, useForm } from './context.tsx';

// ---- Shared pieces -------------------------------------------------------------------------------

const control =
  'block w-full min-h-ctl rounded-md border bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-outline/50';
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
      <label htmlFor={id} className="text-sm font-semibold">
        {label} {optional && <span className="font-normal text-muted-foreground">(optional)</span>}
      </label>
      {hint && (
        <p id={hintId} className="text-[0.8125rem] text-muted-foreground">
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

export function TextField({ path, label, hint, optional, type = 'text', placeholder, maxLength, counter, onValue }: Common & { type?: 'text' | 'url' | 'email' | 'date'; placeholder?: string; maxLength?: number; counter?: number; onValue?: (value: string | undefined) => void }) {
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
        onChange={(e) => {
          const v = e.target.value === '' ? undefined : e.target.value;
          f.set(v);
          onValue?.(v);
        }}
        onBlur={f.blur}
        aria-invalid={!!f.error}
        aria-describedby={describedBy(f, hint)}
        className={`${control} ${controlBorder(f.error)}`}
      />
      {counter !== undefined && (
        <p className={`text-[0.8125rem] ${value.length > counter ? 'font-bold text-error' : 'text-muted-foreground'}`} aria-live="polite">
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
        <Button variant="ghost" className="min-h-8 px-3" onClick={() => setPreview((p) => !p)} aria-pressed={preview}>
          {preview ? 'Back to editing' : 'Preview'}
        </Button>
      </div>
    </Shell>
  );
}

export function NumberField({ path, label, hint, optional = true, min = 0, max, step }: Common & { min?: number; max?: number; step?: number }) {
  const f = useField(path);
  return (
    <Shell {...f} label={label} hint={hint} optional={optional}>
      <input
        id={f.id}
        type="number"
        inputMode={step && step < 1 ? 'decimal' : 'numeric'}
        max={max}
        step={step}
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

export function SelectField({ path, label, hint, optional, options, placeholder = 'Choose…', fallback }: Common & { options: { value: string; label: string }[]; placeholder?: string; /** What the site assumes when the document has no value, so the drop-down says so instead of "Choose". */ fallback?: string }) {
  const f = useField(path);
  return (
    <Shell {...f} label={label} hint={hint} optional={optional}>
      <select
        id={f.id}
        value={(f.value as string | undefined) ?? fallback ?? ''}
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

/** A compact on/off switch with its own label, for a card's header (so it stays reachable when the card is folded). */
export function InlineSwitch({ path, label }: { path: string; label: string }) {
  const f = useField(path);
  return (
    <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-sm font-medium">
      <input id={f.id} type="checkbox" role="switch" checked={f.value === true} onChange={(e) => f.set(e.target.checked ? true : undefined)} onBlur={f.blur} className="size-4 accent-[var(--primary-accent)]" />
      {label}
    </label>
  );
}

/** A 1 to 5 star rating that reads as stars but works as a radio group: keyboard, screen reader and touch. */
export function StarField({ path, label }: { path: string; label: string }) {
  const f = useField(path);
  const value = typeof f.value === 'number' ? f.value : 0;
  const name = `${f.id}-stars`;
  return (
    <fieldset className="grid gap-1.5">
      <legend className="text-sm font-semibold">
        {label} <span className="font-normal text-muted-foreground">(optional)</span>
      </legend>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="grid size-ctl cursor-pointer place-items-center rounded-md hover:bg-muted has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-outline/50">
            <input type="radio" name={name} value={n} checked={value === n} onChange={() => f.set(n)} className="visually-hidden" />
            <span aria-hidden="true" className={`text-xl leading-none ${n <= value ? 'text-primary-accent' : 'text-muted-foreground'}`}>
              {n <= value ? '★' : '☆'}
            </span>
            <span className="visually-hidden">{n} out of 5</span>
          </label>
        ))}
        {value > 0 && (
          <button type="button" onClick={() => f.set(undefined)} className="ml-1 rounded-md px-2 py-1 text-sm text-muted-foreground underline hover:text-foreground">
            Clear
          </button>
        )}
      </div>
    </fieldset>
  );
}

export function CheckField({ path, label, hint }: Omit<Common, 'optional'>) {
  const f = useField(path);
  return (
    <div className="grid grid-cols-1 gap-1">
      <label className="flex min-h-ctl items-start gap-3 font-bold">
        <input id={f.id} type="checkbox" checked={f.value === true} onChange={(e) => f.set(e.target.checked)} onBlur={f.blur} aria-describedby={hint ? f.hintId : undefined} className="mt-1.5 size-5 accent-[var(--primary-accent)]" />
        <span>{label}</span>
      </label>
      {hint && (
        <p id={f.hintId} className="pl-8 text-[0.8125rem] text-muted-foreground">
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
    <fieldset aria-describedby={f.error ? f.errorId : undefined} className="grid grid-cols-1 gap-1.5">
      <legend className="font-bold">{label}</legend>
      {hint && <p className="text-[0.8125rem] text-muted-foreground">{hint}</p>}
      {options.length === 0 && <p className="text-muted-foreground">{empty ?? 'Nothing to choose from yet.'}</p>}
      <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        {options.map((o) => (
          <label key={o.id} className="flex min-h-ctl items-center gap-3">
            <input type="checkbox" checked={selected.includes(o.id)} onChange={(e) => toggle(o.id, e.target.checked)} className="size-5 accent-[var(--primary-accent)]" />
            <span>{labelOf(o)}</span>
          </label>
        ))}
        {stale.map((id) => (
          <label key={id} className="flex min-h-ctl items-center gap-3 text-error">
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
    <fieldset className="grid grid-cols-1 gap-2">
      <legend className="font-bold">{label}</legend>
      {hint && <p className="text-[0.8125rem] text-muted-foreground">{hint}</p>}
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
  summaryField,
  headerExtra,
}: {
  path: string;
  label: string;
  itemLabel: string;
  addLabel: string;
  empty: () => unknown;
  hint?: ReactNode;
  children: (itemPath: string, index: number) => ReactNode;
  /**
   * Which field names an item ("title"). With it the items fold up to one line when there are more than three, so a
   * long agenda stays manageable. A new item opens by itself, and so does any item with a problem in it.
   */
  summaryField?: string;
  /** Something to show in each card's header, such as a "Sold out" switch. */
  headerExtra?: (itemPath: string, index: number) => ReactNode;
}) {
  const form = useForm();
  const items = (getIn(form.doc, path) as unknown[] | undefined) ?? [];
  const groupErrors = form.errorsUnder(path).filter((e) => e.path === path);
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set(items.length > 3 ? [] : items.map((_, i) => i)));
  const length = useRef(items.length);
  useEffect(() => {
    if (items.length > length.current) setOpen((o) => new Set(o).add(items.length - 1));
    length.current = items.length;
  }, [items.length]);
  const isOpen = (i: number) => !summaryField || open.has(i) || form.errorsUnder(`${path}.${i}`).length > 0;
  const toggle = (i: number) => setOpen((o) => (o.has(i) ? new Set([...o].filter((x) => x !== i)) : new Set(o).add(i)));
  return (
    <fieldset className="grid grid-cols-1 gap-4">
      <legend className="text-base font-bold font-display">{label}</legend>
      {hint && <p className="-mt-2 text-[0.8125rem] text-muted-foreground">{hint}</p>}
      {groupErrors.map((e) => (
        <p key={e.message} className="font-medium text-error">
          {e.message}
        </p>
      ))}
      {items.length === 0 && <p className="text-muted-foreground">None yet.</p>}
      {items.map((_, i) => (
        <div key={i} role="group" aria-label={`${itemLabel} ${i + 1}`} className="grid grid-cols-1 gap-4 rounded-md border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {summaryField ? (
              <button type="button" aria-expanded={isOpen(i)} onClick={() => toggle(i)} className="flex min-h-8 min-w-0 flex-1 items-center gap-2 text-left font-bold" title={isOpen(i) ? 'Fold up' : 'Open'}>
                <span aria-hidden="true" className={`transition-transform ${isOpen(i) ? 'rotate-180' : ''}`}>
                  <Icon name="chevron-down" size={18} />
                </span>
                <span>
                  {itemLabel} {i + 1}
                </span>
                {!isOpen(i) && <span className="min-w-0 truncate font-normal text-muted-foreground">{String(getIn(form.doc, `${path}.${i}.${summaryField}`) ?? '') || 'Not filled in yet'}</span>}
              </button>
            ) : (
              <p className="font-bold">
                {itemLabel} {i + 1}
              </p>
            )}
            {headerExtra?.(`${path}.${i}`, i)}
            <div className="flex flex-wrap gap-1">
              <Button variant="ghost" className="min-h-8 px-2.5" disabled={i === 0} aria-label={`Move ${itemLabel} ${i + 1} up`} title="Move up" onClick={() => form.update((d) => move(d, path, i, i - 1))}>
                <Icon name="arrow-up" size={18} />
              </Button>
              <Button variant="ghost" className="min-h-8 px-2.5" disabled={i === items.length - 1} aria-label={`Move ${itemLabel} ${i + 1} down`} title="Move down" onClick={() => form.update((d) => move(d, path, i, i + 1))}>
                <Icon name="arrow-down" size={18} />
              </Button>
              <Button variant="ghost" className="min-h-8 px-2.5" aria-label={`Remove ${itemLabel} ${i + 1}`} title="Remove" onClick={() => form.update((d) => removeAt(d, path, i))}>
                <Icon name="trash" size={18} />
              </Button>
            </div>
          </div>
          <div className={isOpen(i) ? 'grid grid-cols-1 gap-4' : 'hidden'}>{children(`${path}.${i}`, i)}</div>
        </div>
      ))}
      <div>
        <Button onClick={() => form.update((d) => append(d, path, empty()))}>{addLabel}</Button>
      </div>
    </fieldset>
  );
}

/**
 * A titled card of related fields, with a count of problems inside it. With `step` it is one numbered step of a
 * long form (the steps list on the left jumps to it by `id`).
 */
export function Section({ title, hint, children, errorPrefix, id, step, tag }: { title: string; hint?: ReactNode; children: ReactNode; errorPrefix?: string; id?: string; step?: number; tag?: string }) {
  const form = useForm();
  const groupErrors = errorPrefix ? form.errorsUnder(errorPrefix).filter((e) => e.path === errorPrefix) : [];
  return (
    <section id={id} data-step={id} aria-labelledby={id ? `${id}-title` : undefined} className="grid grid-cols-1 scroll-mt-6 gap-5 rounded-lg border border-border bg-card p-5 sm:p-7">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          {step !== undefined && (
            <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-primary font-display text-lg font-bold text-primary-foreground">
              {step}
            </span>
          )}
          <h2 id={id ? `${id}-title` : undefined} className="text-lg">
            {title}
          </h2>
          {tag && <span className="rounded-full border border-border px-2.5 py-0.5 text-sm text-muted-foreground">{tag}</span>}
        </div>
        {hint && <p className="mt-2 text-muted-foreground">{hint}</p>}
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

/** Rarely needed fields, folded away so they do not crowd the ones everybody fills in. Open by default when they hold something. */
export function Disclosure({ title, hint, open, children }: { title: string; hint?: ReactNode; open?: boolean; children: ReactNode }) {
  return (
    <details open={open || undefined} className="group rounded-md border border-border">
      <summary className="flex min-h-ctl cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 font-bold hover:bg-muted [&::-webkit-details-marker]:hidden">
        <span>
          {title}
          {hint && <span className="block text-[0.8125rem] font-normal text-muted-foreground">{hint}</span>}
        </span>
        <span aria-hidden="true" className="text-muted-foreground transition-transform group-open:rotate-180">
          <Icon name="chevron-down" />
        </span>
      </summary>
      <div className="grid grid-cols-1 gap-5 border-t border-border p-4">{children}</div>
    </details>
  );
}

// ---- Photos --------------------------------------------------------------------------------------

export { CoverPhotoField, MediaField, PhotoManager } from './photos.tsx';
