import { useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import { ApiError } from '../lib/api.ts';
import { mediaUrl } from '../lib/media.ts';
import { append, getIn, move, removeAt } from '../lib/path.ts';
import { useApp } from '../state/app.tsx';
import { Icon } from '../ui/icons.tsx';
import { Button, Modal } from '../ui/primitives.tsx';
import { useField, useForm } from './context.tsx';

// ---- Shared ----------------------------------------------------------------------------------------

export const EXT_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', tif: 'image/tiff', tiff: 'image/tiff' };
const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,image/gif,image/tiff';

/** Why a file cannot be used, in words an organizer can act on; undefined when it is fine. */
export function problemWith(file: File): string | undefined {
  const ext = file.name.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase() ?? '';
  if (EXT_TYPES[ext]) return undefined;
  return /^hei[cf]$/.test(ext) ? 'iPhone HEIC photos are not supported. Export the photo as JPEG and try again.' : 'Choose a JPEG, PNG, WebP, AVIF, GIF or TIFF image.';
}

/** The site never shows more than 1600px, so a 6000px camera original only slows the upload down. */
export const LONGEST_SIDE = 3200;

/**
 * Shrinks a very large photo in the browser before it is sent, keeping its type and orientation. Anything it cannot
 * handle (other formats, no canvas support, an error) is sent exactly as it was.
 */
export async function shrinkIfHuge(file: File): Promise<File> {
  if (typeof createImageBitmap !== 'function' || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= LONGEST_SIDE) {
      bitmap.close();
      return file;
    }
    const scale = LONGEST_SIDE / longest;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, file.type, 0.9));
    return blob && blob.size < file.size ? new File([blob], file.name, { type: file.type, lastModified: file.lastModified }) : file;
  } catch {
    return file;
  }
}

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

/** What the organizer just picked, shown at once while the site's own resized copy is still being made. */
const previews = new Map<string, string>();

/** A photo that may still be resizing: shows the picked file if we have it, and keeps trying the site copy. */
export function Thumb({ mediaKey, alt, className = '' }: { mediaKey: string; alt: string; className?: string }) {
  const { config } = useApp();
  const [tries, setTries] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!failed || tries >= 20) return;
    const t = setTimeout(() => (setFailed(false), setTries((n) => n + 1)), 3000);
    return () => clearTimeout(t);
  }, [failed, tries]);
  const local = previews.get(mediaKey);
  const src = local ?? `${mediaUrl(config.siteUrl, mediaKey, 960)}${tries ? `?t=${tries}` : ''}`;
  if (failed && !local) {
    return (
      <div role="img" aria-label={`${alt} (still being resized)`} className={`grid place-items-center bg-muted text-center text-sm text-muted-foreground ${className}`}>
        <span>
          <Icon name="photo" size={28} />
          <br />
          Getting ready…
        </span>
      </div>
    );
  }
  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className={`bg-muted object-cover ${className}`} />;
}

// ---- One photo -------------------------------------------------------------------------------------

type MediaState = { kind: 'idle' } | { kind: 'uploading' } | { kind: 'processing' } | { kind: 'ready' } | { kind: 'error'; message: string };

/** Upload one photo straight to S3 (a signed link from the API) and store its key at `path`. */
function useSingleUpload(path: string) {
  const { api, config } = useApp();
  const form = useForm();
  const f = useField(path);
  const [state, setState] = useState<MediaState>({ kind: 'idle' });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => void (alive.current = false);
  }, []);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    const problem = problemWith(file);
    if (problem) return setState({ kind: 'error', message: problem });
    if (!form.mediaFolder) return setState({ kind: 'error', message: 'Give this item a name first, then add the photo.' });
    setState({ kind: 'uploading' });
    try {
      const ext = file.name.match(/\.([A-Za-z0-9]+)$/)![1]!.toLowerCase();
      const signed = await api.signUpload({ folder: form.mediaFolder, filename: file.name, contentType: file.type || EXT_TYPES[ext]! });
      await api.uploadFile(signed, file);
      if (!alive.current) return;
      previews.set(signed.mediaKey, URL.createObjectURL(file));
      f.set(signed.mediaKey);
      setState({ kind: 'processing' });
      const ok = await waitForImage(mediaUrl(config.siteUrl, signed.mediaKey));
      if (alive.current) setState(ok ? { kind: 'ready' } : { kind: 'error', message: 'The photo uploaded but is taking a while to process. It will appear on the site shortly.' });
    } catch (e: any) {
      if (alive.current) setState({ kind: 'error', message: e?.message ?? 'The upload failed. Try again.' });
    }
  };
  const clear = () => (f.set(undefined), setState({ kind: 'idle' }));
  return { f, key: f.value as string | undefined, state, choose, clear, busy: state.kind === 'uploading' || state.kind === 'processing' };
}

function UploadStatus({ state }: { state: MediaState }) {
  return (
    <>
      <p role="status" className="text-[0.8125rem] text-muted-foreground">
        {state.kind === 'uploading' && 'Uploading…'}
        {state.kind === 'processing' && 'Uploaded. Resizing for the site…'}
        {state.kind === 'ready' && 'Ready.'}
      </p>
      {state.kind === 'error' && (
        <p role="alert" className="font-medium text-error">
          {state.message}
        </p>
      )}
    </>
  );
}

interface Common {
  path: string;
  label: string;
  hint?: ReactNode;
  optional?: boolean;
}

/** A single photo (speaker, sponsor logo, team member, blog image). */
export function MediaField({ path, label, hint, optional = true }: Common) {
  const { f, key, state, choose, clear, busy } = useSingleUpload(path);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="grid grid-cols-1 gap-1.5">
      <p className="font-bold" id={`${f.id}-label`}>
        {label} {optional && <span className="font-normal text-muted-foreground">(optional)</span>}
      </p>
      {hint && <p className="text-[0.8125rem] text-muted-foreground">{hint}</p>}
      <div className="flex flex-wrap items-center gap-4">
        {key && <Thumb mediaKey={key} alt={`Current ${label.toLowerCase()}`} className="h-24 w-40 rounded-md border border-border" />}
        <div className="grid grid-cols-1 gap-2">
          <input ref={input} id={f.id} type="file" accept={ACCEPT} className="visually-hidden" aria-labelledby={`${f.id}-label`} onChange={(e) => void choose(e.target.files?.[0])} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => input.current?.click()} disabled={busy}>
              {key ? 'Replace photo' : 'Choose photo'}
            </Button>
            {key && (
              <Button variant="ghost" onClick={clear} disabled={busy}>
                Remove
              </Button>
            )}
          </div>
          <UploadStatus state={state} />
        </div>
      </div>
      {f.error && <p className="font-medium text-error">{f.error}</p>}
    </div>
  );
}

// ---- The event cover -------------------------------------------------------------------------------

export interface GalleryItem {
  media: string;
  alt: string;
}

/**
 * The photo at the top of the event page. Before the event it is uploaded; afterwards it can be swapped for any
 * of the event's own photos with one click.
 */
export function CoverPhotoField({ path, label, hint, galleryPath }: Common & { galleryPath: string }) {
  const form = useForm();
  const { f, key, state, choose, clear, busy } = useSingleUpload(path);
  const input = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  const gallery = ((getIn(form.doc, galleryPath) as GalleryItem[] | undefined) ?? []).filter((g) => g?.media);

  return (
    <div className="grid grid-cols-1 gap-3">
      <p className="font-bold" id={`${f.id}-label`}>
        {label} <span className="font-normal text-muted-foreground">(optional)</span>
      </p>
      {hint && <p className="text-[0.8125rem] text-muted-foreground">{hint}</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,20rem)_1fr]">
        <div className="aspect-[3/2] overflow-hidden rounded-md border border-border bg-muted">
          {key ? (
            <Thumb mediaKey={key} alt="Current cover photo" className="size-full" />
          ) : (
            <div className="grid size-full place-items-center p-4 text-center text-muted-foreground">
              <span>
                <Icon name="photo-star" size={32} />
                <br />
                No cover photo yet
              </span>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 content-start gap-2">
          <input ref={input} id={f.id} type="file" accept={ACCEPT} className="visually-hidden" aria-labelledby={`${f.id}-label`} onChange={(e) => void choose(e.target.files?.[0])} />
          <Button onClick={() => input.current?.click()} disabled={busy}>
            <Icon name="cloud-upload" size={18} />
            {key ? 'Replace cover photo' : 'Upload cover photo'}
          </Button>
          {gallery.length > 0 && (
            <Button onClick={() => setPicking(true)} disabled={busy}>
              <Icon name="photo-star" size={18} />
              Choose from event photos
            </Button>
          )}
          {key && (
            <Button variant="ghost" onClick={clear} disabled={busy}>
              Remove cover photo
            </Button>
          )}
          <UploadStatus state={state} />
        </div>
      </div>
      {f.error && <p className="font-medium text-error">{f.error}</p>}

      <Modal open={picking} title="Choose the cover photo" onClose={() => setPicking(false)} size="wide">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {gallery.map((g, i) => (
            <li key={g.media}>
              <button
                type="button"
                className={`block w-full overflow-hidden rounded-md border-2 ${g.media === key ? 'border-primary' : 'border-border'} hover:border-primary-accent`}
                aria-label={`Use photo ${i + 1} as the cover${g.media === key ? ' (current cover)' : ''}`}
                onClick={() => (f.set(g.media), setPicking(false))}
              >
                <Thumb mediaKey={g.media} alt="" className="aspect-[3/2] w-full" />
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}

// ---- The event gallery -----------------------------------------------------------------------------

/** Most photos in one go; more than this and the browser, not the website, becomes the slow part. */
export const MAX_BATCH = 100;
const PARALLEL = 3;
/** Past this many the page gets heavy to scroll; a link to the full album serves visitors better. */
const MANY = 60;

interface Tile {
  id: number;
  file: File;
  status: 'waiting' | 'preparing' | 'uploading' | 'failed';
  progress: number;
  error?: string;
}

/**
 * Many photos at once: choose or drag a whole folder's worth, watch each one upload, then set the cover, put them
 * in order and describe them. Photos land in the order of their file names, however fast each upload is.
 */
export function PhotoManager({ path, coverPath, defaultAlt }: { path: string; coverPath: string; defaultAlt: string }) {
  const { api } = useApp();
  const form = useForm();
  const formRef = useRef(form);
  formRef.current = form;
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);
  const hintId = useId();

  const items = ((getIn(form.doc, path) as GalleryItem[] | undefined) ?? []).filter(Boolean);
  const cover = getIn(form.doc, coverPath) as string | undefined;
  const standardAlt = items.filter((g) => /^Photo from /.test(g.alt ?? '')).length;

  const patch = (id: number, change: Partial<Tile>) => setTiles((t) => t.map((x) => (x.id === id ? { ...x, ...change } : x)));
  const drop = (id: number) => setTiles((t) => t.filter((x) => x.id !== id));

  /** Uploads one file; resolves to the gallery entry, or undefined when it failed (the tile then offers Retry). */
  const upload = async (tile: Tile): Promise<GalleryItem | undefined> => {
    const folder = formRef.current.mediaFolder;
    try {
      patch(tile.id, { status: 'preparing', progress: 0, error: undefined });
      const file = await shrinkIfHuge(tile.file);
      patch(tile.id, { status: 'uploading' });
      const ext = file.name.match(/\.([A-Za-z0-9]+)$/)![1]!.toLowerCase();
      const signed = await api.signUpload({ folder: folder!, filename: file.name, contentType: file.type || EXT_TYPES[ext]! });
      await api.uploadFile(signed, file, (p) => patch(tile.id, { progress: p }));
      previews.set(signed.mediaKey, URL.createObjectURL(file));
      drop(tile.id);
      return { media: signed.mediaKey, alt: defaultAlt };
    } catch (e: any) {
      if (e?.name === 'AuthError') throw e;
      patch(tile.id, { status: 'failed', error: e instanceof ApiError || e?.message ? e.message : 'The upload failed. Try again.' });
      return undefined;
    }
  };

  /** Runs the files PARALLEL at a time and adds each photo to the gallery in file-name order as soon as it can. */
  const run = async (batch: Tile[]) => {
    const results: (GalleryItem | undefined | null)[] = batch.map(() => null); // null = still going
    let flushed = 0;
    const flush = () => {
      const ready: GalleryItem[] = [];
      while (flushed < results.length && results[flushed] !== null) {
        const r = results[flushed];
        if (r) ready.push(r);
        flushed++;
      }
      if (ready.length) formRef.current.update((d) => ready.reduce((doc, item) => append(doc, path, item), d));
    };
    let next = 0;
    const worker = async () => {
      for (;;) {
        const i = next++;
        if (i >= batch.length) return;
        results[i] = await upload(batch[i]!);
        flush();
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, batch.length) }, worker)).catch((e) => {
      if (e?.name === 'AuthError') return;
      throw e;
    });
  };

  const addFiles = (picked: File[]) => {
    const notes: string[] = [];
    if (!formRef.current.mediaFolder) {
      setProblems(['Give this event a title first, then add photos. They are filed under the event.']);
      return;
    }
    let files = [...picked].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (files.length > MAX_BATCH) {
      notes.push(`Only the first ${MAX_BATCH} photos were added. Add the rest in a second go.`);
      files = files.slice(0, MAX_BATCH);
    }
    const usable: File[] = [];
    for (const f of files) {
      const problem = problemWith(f);
      if (problem) notes.push(`${f.name}: ${problem}`);
      else usable.push(f);
    }
    setProblems(notes);
    if (!usable.length) return;
    const batch: Tile[] = usable.map((file) => ({ id: nextId.current++, file, status: 'waiting', progress: 0 }));
    setTiles((t) => [...t, ...batch]);
    void run(batch);
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    addFiles([...(e.target.files ?? [])]);
    e.target.value = ''; // choosing the same files again must still work
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    addFiles([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/') || problemWith(f)));
  };

  const retry = async (tile: Tile) => {
    const item = await upload(tile);
    if (item) formRef.current.update((d) => append(d, path, item));
  };

  const setAlt = (i: number, alt: string) => form.set(`${path}.${i}.alt`, alt);

  return (
    <div className="grid grid-cols-1 gap-5">
      <div
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`grid justify-items-center gap-3 rounded-md border-2 border-dashed px-4 py-8 text-center ${over ? 'border-primary bg-primary/10' : 'border-input bg-muted/50'}`}
      >
        <Icon name="photo-plus" size={36} />
        <p id={hintId} className="max-w-md text-muted-foreground">
          Drag photos here, or choose them. You can pick many at once, up to {MAX_BATCH} at a time. JPEG, PNG or WebP, up to 25 MB each.
        </p>
        <input ref={input} id={`f-${path}-add`} type="file" accept={ACCEPT} multiple className="visually-hidden" aria-describedby={hintId} aria-label="Add photos" onChange={onPick} />
        <Button variant="primary" onClick={() => input.current?.click()}>
          <Icon name="photo-plus" size={18} />
          Add photos
        </Button>
      </div>

      {problems.length > 0 && (
        <div role="alert" className="rounded-md border-l-4 border-error bg-error/10 p-4">
          <ul className="list-disc pl-5">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <Button variant="ghost" className="mt-2 min-h-8 px-3" onClick={() => setProblems([])}>
            Dismiss
          </Button>
        </div>
      )}

      {tiles.length > 0 && (
        <ul aria-label="Uploading" className="grid grid-cols-1 gap-2">
          {tiles.map((t) => (
            <li key={t.id} className="grid grid-cols-1 gap-1 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold break-all">{t.file.name}</span>
                {t.status === 'failed' ? (
                  <span className="flex gap-1">
                    <Button className="min-h-8 px-3" onClick={() => void retry(t)}>
                      Retry
                    </Button>
                    <Button variant="ghost" className="min-h-8 px-3" aria-label={`Skip ${t.file.name}`} onClick={() => drop(t.id)}>
                      Skip
                    </Button>
                  </span>
                ) : (
                  <span className="text-[0.8125rem] text-muted-foreground">{t.status === 'waiting' ? 'Waiting…' : t.status === 'preparing' ? 'Preparing…' : `Uploading… ${Math.round(t.progress * 100)}%`}</span>
                )}
              </div>
              {t.status === 'uploading' && <progress className="h-2 w-full accent-[var(--primary-accent)]" value={t.progress} max={1} aria-label={`Uploading ${t.file.name}`} />}
              {t.error && <p className="font-medium text-error">{t.error}</p>}
            </li>
          ))}
        </ul>
      )}

      {items.length === 0 && tiles.length === 0 && <p className="text-muted-foreground">No photos yet. Add the ones from the day and they appear here.</p>}

      {items.length > 0 && (
        <>
          <p className="text-muted-foreground" aria-live="polite">
            {items.length} {items.length === 1 ? 'photo' : 'photos'}.{' '}
            {standardAlt > 0 && `${standardAlt} still ${standardAlt === 1 ? 'has' : 'have'} the standard description. A short line about what is in each one helps visitors who cannot see the photo.`}
          </p>
          {items.length > MANY && <p className="rounded-md bg-info p-3 text-info-foreground">That is a lot of photos for one page. Consider putting the full set in an online album (below) and keeping the best ones here.</p>}
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((g, i) => {
              const isCover = g.media === cover;
              const altId = `f-${path}-${i}-alt`;
              const altError = form.error(`${path}.${i}.alt`);
              return (
                <li key={g.media} className={`grid content-start overflow-hidden rounded-md border bg-card ${isCover ? 'border-primary border-2' : 'border-border'}`}>
                  <div className="relative">
                    <Thumb mediaKey={g.media} alt="" className="aspect-[3/2] w-full" />
                    {isCover && (
                      <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-sm font-bold text-primary-foreground">
                        <Icon name="photo-star" size={14} />
                        Cover
                      </span>
                    )}
                    <span className="absolute right-2 bottom-2 rounded-full bg-ink px-2 text-sm text-ink-foreground">{i + 1}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 p-3">
                    <label htmlFor={altId} className="text-[0.8125rem] font-bold">
                      Describe photo {i + 1}
                    </label>
                    <input
                      id={altId}
                      value={g.alt ?? ''}
                      onChange={(e) => setAlt(i, e.target.value)}
                      onBlur={() => form.blur(`${path}.${i}.alt`)}
                      aria-invalid={!!altError}
                      className={`block min-h-ctl w-full rounded-md border bg-background px-3 py-2 ${altError ? 'border-error' : 'border-input'}`}
                    />
                    {altError && <p className="font-medium text-error">{altError}</p>}
                    <div className="flex flex-wrap items-center gap-1">
                      {!isCover && (
                        <Button className="min-h-8 px-3" aria-label={`Set photo ${i + 1} as the cover`} onClick={() => form.set(coverPath, g.media)}>
                          Set as cover
                        </Button>
                      )}
                      <Button variant="ghost" className="min-h-8 px-2" disabled={i === 0} aria-label={`Move photo ${i + 1} earlier`} onClick={() => form.update((d) => move(d, path, i, i - 1))}>
                        <Icon name="arrow-left" size={18} />
                      </Button>
                      <Button variant="ghost" className="min-h-8 px-2" disabled={i === items.length - 1} aria-label={`Move photo ${i + 1} later`} onClick={() => form.update((d) => move(d, path, i, i + 1))}>
                        <Icon name="arrow-right" size={18} />
                      </Button>
                      <Button variant="ghost" className="min-h-8 px-2" aria-label={`Remove photo ${i + 1}`} onClick={() => form.update((d) => removeAt(d, path, i))}>
                        <Icon name="trash" size={18} />
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
