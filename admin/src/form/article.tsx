import { useEffect, useMemo, useRef, useState } from 'react';
import { renderMarkdown } from '../../../src/lib/markdown.ts';
import { ApiError } from '../lib/api.ts';
import { EXT_TYPES, problemWith } from './photos.tsx';
import { useApp } from '../state/app.tsx';
import { Icon, type IconName } from '../ui/icons.tsx';
import { Button } from '../ui/primitives.tsx';
import { useField, useForm } from './context.tsx';

type Mode = 'write' | 'preview' | 'split';

/** What a post says about its length. The same sum the website uses for "N min read". */
export const readingMinutes = (text: string) => Math.max(1, Math.round(text.trim().split(/\s+/).filter(Boolean).length / 220));

/** The picture variant that goes into a post: the 960px WebP the resize function makes (SVGs are used as they are). */
const mediaPath = (key: string) => (/\.svg$/i.test(key) ? `/media/${key}` : `/media/${key.replace(/\.[^.]+$/, '')}-960.webp`);

interface Tool {
  label: string;
  icon: IconName;
  /** Text put before and after the selection, and what to show when nothing is selected. */
  wrap?: [string, string, string];
  /** Text put at the start of each selected line. */
  linePrefix?: string;
}

const TOOLS: Tool[] = [
  { label: 'Bold', icon: 'bold', wrap: ['**', '**', 'bold text'] },
  { label: 'Italic', icon: 'italic', wrap: ['*', '*', 'italic text'] },
  { label: 'Heading', icon: 'heading', linePrefix: '## ' },
  { label: 'Bullet list', icon: 'list', linePrefix: '- ' },
  { label: 'Quote', icon: 'quote', linePrefix: '> ' },
  { label: 'Link', icon: 'link', wrap: ['[', '](https://)', 'link text'] },
];

/**
 * A Markdown editor for blog posts: a small toolbar, write / preview / side by side, and "Insert photo", which
 * uploads through the same signed link as every other photo and puts the picture in at the cursor.
 */
export function ArticleEditor({ path, label, rows = 18 }: { path: string; label: string; rows?: number }) {
  const { api, config } = useApp();
  const form = useForm();
  const f = useField(path);
  const value = (f.value as string | undefined) ?? '';
  const area = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>(() => (typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1024px)').matches ? 'split' : 'write'));
  const [picture, setPicture] = useState<{ state: 'uploading' } | { state: 'ready'; media: string; alt: string } | { state: 'error'; message: string } | null>(null);
  const caret = useRef<{ start: number; end: number } | null>(null);

  const html = useMemo(() => {
    const out = renderMarkdown(value) || '<p>Nothing to preview yet.</p>';
    // Pictures live on the website's address, not the admin's.
    return out.replaceAll('src="/media/', `src="${config.siteUrl}/media/`);
  }, [value, config.siteUrl]);

  const remember = () => {
    const a = area.current;
    if (a) caret.current = { start: a.selectionStart, end: a.selectionEnd };
  };
  const set = (next: string, selectFrom?: number, selectTo?: number) => {
    f.set(next === '' ? undefined : next);
    requestAnimationFrame(() => {
      const a = area.current;
      if (!a) return;
      a.focus();
      if (selectFrom !== undefined) a.setSelectionRange(selectFrom, selectTo ?? selectFrom);
    });
  };

  const apply = (tool: Tool) => {
    const a = area.current;
    const { start, end } = a ? { start: a.selectionStart, end: a.selectionEnd } : (caret.current ?? { start: value.length, end: value.length });
    if (tool.wrap) {
      const [before, after, placeholder] = tool.wrap;
      const chosen = value.slice(start, end) || placeholder;
      set(value.slice(0, start) + before + chosen + after + value.slice(end), start + before.length, start + before.length + chosen.length);
    } else if (tool.linePrefix) {
      const from = value.lastIndexOf('\n', start - 1) + 1;
      const lines = value.slice(from, end).split('\n');
      const text = lines.map((l) => (l.startsWith(tool.linePrefix!) ? l : tool.linePrefix + l)).join('\n');
      set(value.slice(0, from) + text + value.slice(end), from, from + text.length);
    }
  };

  const choose = async (picked: File | undefined) => {
    if (!picked) return;
    const problem = problemWith(picked);
    if (problem) return setPicture({ state: 'error', message: problem });
    if (!form.mediaFolder) return setPicture({ state: 'error', message: 'Give the post a title first, then add photos. They are filed under the post.' });
    remember();
    setPicture({ state: 'uploading' });
    try {
      const ext = picked.name.match(/\.([A-Za-z0-9]+)$/)![1]!.toLowerCase();
      const signed = await api.signUpload({ folder: form.mediaFolder, filename: picked.name, contentType: picked.type || EXT_TYPES[ext]! });
      await api.uploadFile(signed, picked);
      setPicture({ state: 'ready', media: signed.mediaKey, alt: '' });
    } catch (e: any) {
      if (e?.name === 'AuthError') return;
      setPicture({ state: 'error', message: e instanceof ApiError || e?.message ? e.message : 'The upload failed. Try again.' });
    }
  };

  const insert = () => {
    if (picture?.state !== 'ready') return;
    const { start, end } = caret.current ?? { start: value.length, end: value.length };
    const md = `![${picture.alt.replace(/[\]\[\n]/g, ' ').trim()}](${mediaPath(picture.media)})`;
    // A picture stands on its own paragraph: a blank line before and after, however the cursor sat.
    const before = value.slice(0, start);
    const after = value.slice(end);
    const lead = before === '' ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const tail = after === '' ? '' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
    set(value.slice(0, start) + lead + md + tail + value.slice(end), start + lead.length + md.length + tail.length);
    setPicture(null);
  };

  useEffect(() => {
    if (!f.error) return;
    area.current?.setAttribute('aria-invalid', 'true');
  }, [f.error]);

  const modes: { id: Mode; label: string }[] = [
    { id: 'write', label: 'Write' },
    { id: 'preview', label: 'Preview' },
    { id: 'split', label: 'Side by side' },
  ];
  return (
    <div className="grid grid-cols-1 gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={f.id} className="text-sm font-semibold">
          {label}
        </label>
        <div role="group" aria-label="Editor view" className="inline-flex rounded-md border border-input p-0.5">
          {modes.map((m) => (
            <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => setMode(m.id)} className={`min-h-8 rounded px-3 text-sm font-medium ${mode === m.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {mode !== 'preview' && (
        <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-muted p-1">
          {TOOLS.map((t) => (
            <button key={t.label} type="button" onClick={() => apply(t)} title={t.label} className="grid size-ctl place-items-center rounded-md hover:bg-card">
              <Icon name={t.icon} size={18} />
              <span className="visually-hidden">{t.label}</span>
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/tiff" className="visually-hidden" aria-label="Choose a photo to insert" onChange={(e) => (void choose(e.target.files?.[0]), (e.target.value = ''))} />
          <Button variant="ghost" className="min-h-8 px-2.5" onClick={() => (remember(), file.current?.click())} disabled={picture?.state === 'uploading'}>
            <Icon name="photo-plus" size={18} />
            Insert photo
          </Button>
        </div>
      )}

      {picture?.state === 'uploading' && (
        <p role="status" className="text-sm text-muted-foreground">
          Uploading the photo…
        </p>
      )}
      {picture?.state === 'error' && (
        <p role="alert" className="text-sm font-medium text-error">
          {picture.message}
        </p>
      )}
      {picture?.state === 'ready' && (
        <div className="grid grid-cols-1 gap-2 rounded-md border border-border bg-card p-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="grid gap-1">
            <label htmlFor={`${f.id}-alt`} className="text-sm font-semibold">
              Describe the photo
            </label>
            <input
              id={`${f.id}-alt`}
              value={picture.alt}
              onChange={(e) => setPicture({ ...picture, alt: e.target.value })}
              placeholder="For example: Speakers on stage at the opening keynote"
              className="block min-h-ctl w-full rounded-md border border-input bg-background px-3"
            />
            <p className="text-[0.8125rem] text-muted-foreground">For people who cannot see it. A short line is enough.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" onClick={insert} disabled={!picture.alt.trim()}>
              Add to post
            </Button>
            <Button variant="ghost" onClick={() => setPicture(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className={mode === 'split' ? 'grid grid-cols-1 gap-3 lg:grid-cols-2' : 'grid grid-cols-1 gap-3'}>
        {mode !== 'preview' && (
          <textarea
            ref={area}
            id={f.id}
            rows={rows}
            value={value}
            onChange={(e) => f.set(e.target.value === '' ? undefined : e.target.value)}
            onBlur={() => (remember(), f.blur())}
            onSelect={remember}
            aria-invalid={!!f.error}
            className={`block w-full rounded-md border bg-background px-3 py-2 font-mono text-sm leading-relaxed ${f.error ? 'border-error' : 'border-input'}`}
          />
        )}
        {mode !== 'write' && <div className="prose-md min-h-40 rounded-md border border-border bg-card p-4" aria-label={`${label} preview`} dangerouslySetInnerHTML={{ __html: html }} />}
      </div>
      <p className="text-[0.8125rem] text-muted-foreground">
        {value.trim() ? `${readingMinutes(value)} min read` : 'Nothing written yet'}. Formatting: **bold**, *italic*, ## heading, - list, [text](https://link).
      </p>
      {f.error && <p className="font-medium text-error">{f.error}</p>}
    </div>
  );
}

/** Topics as chips. Type and press Enter or comma; the ones used on other posts are offered as suggestions. */
export function TagsField({ path, label, suggestions = [] }: { path: string; label: string; suggestions?: string[] }) {
  const form = useForm();
  const f = useField(path);
  const tags = ((f.value as string[] | undefined) ?? []).filter(Boolean);
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const t = raw.trim().replace(/\s+/g, ' ');
    if (!t || tags.some((x) => x.toLowerCase() === t.toLowerCase())) return setDraft('');
    form.set(path, [...tags, t]);
    setDraft('');
  };
  const left = suggestions.filter((s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase())).slice(0, 8);
  return (
    <div className="grid grid-cols-1 gap-2">
      <label htmlFor={f.id} className="text-sm font-semibold">
        {label} <span className="font-normal text-muted-foreground">(optional)</span>
      </label>
      {tags.length > 0 && (
        <ul aria-label="Chosen tags" className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <li key={t} className="inline-flex items-center gap-1 rounded-md border border-border bg-muted py-0.5 pr-0.5 pl-2 text-sm">
              {t}
              <button type="button" aria-label={`Remove tag ${t}`} onClick={() => form.set(path, tags.filter((x) => x !== t))} className="grid size-6 place-items-center rounded hover:bg-card">
                <Icon name="x" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        id={f.id}
        value={draft}
        onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value.slice(0, -1)) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(draft);
          } else if (e.key === 'Backspace' && !draft && tags.length) form.set(path, tags.slice(0, -1));
        }}
        onBlur={() => draft.trim() && add(draft)}
        placeholder="Type a topic, press Enter"
        className="block min-h-ctl w-full rounded-md border border-input bg-background px-3"
      />
      {left.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
          Used before:
          {left.map((s) => (
            <button key={s} type="button" onClick={() => add(s)} className="rounded-md border border-input px-2 py-0.5 hover:bg-muted">
              + {s}
            </button>
          ))}
        </p>
      )}
    </div>
  );
}
