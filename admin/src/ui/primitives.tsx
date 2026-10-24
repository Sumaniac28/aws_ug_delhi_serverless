import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { Icon } from './icons.tsx';

type Variant = 'primary' | 'outline' | 'ghost' | 'danger';

const base =
  'inline-flex min-h-ctl items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold no-underline transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-3 focus-visible:ring-outline/50';
const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-[color-mix(in_oklch,var(--primary),white_14%)]',
  outline: 'border border-input bg-background text-foreground hover:bg-muted',
  ghost: 'text-foreground hover:bg-muted',
  danger: 'bg-error text-error-foreground hover:opacity-90',
};

export const buttonClass = (variant: Variant = 'outline', extra = '') => `${base} ${variants[variant]} ${extra}`;

export function Button({ variant = 'outline', className = '', type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type={type} className={buttonClass(variant, className)} {...rest} />;
}

export function ButtonLink({ variant = 'outline', className = '', ...rest }: LinkProps & { variant?: Variant }) {
  return <Link className={buttonClass(variant, className)} {...rest} />;
}

const tones = {
  neutral: 'border border-border text-foreground',
  success: 'bg-success text-success-foreground',
  warning: 'bg-warning text-warning-foreground',
  error: 'bg-error text-error-foreground',
  info: 'bg-info text-info-foreground',
} as const;

export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-medium whitespace-nowrap ${tones[tone]}`}>{children}</span>;
}

const alertTones = {
  error: 'border-error bg-error/10',
  warning: 'border-warning-foreground/40 bg-warning',
  info: 'border-border bg-muted',
  success: 'border-success-foreground/40 bg-success',
} as const;

/** Inline message. Errors are announced immediately; others politely. */
export function Alert({ tone = 'info', title, children, actions }: { tone?: keyof typeof alertTones; title?: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-md border-l-4 p-4 ${alertTones[tone]} ${tone === 'warning' || tone === 'success' ? 'text-warning-foreground' : ''}`}>
      {title && <p className="font-bold">{title}</p>}
      {children && <div className={title ? 'mt-1' : ''}>{children}</div>}
      {actions && <div className="mt-3 flex flex-wrap gap-3">{actions}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <p role="status" className="text-muted-foreground">
      {label}…
    </p>
  );
}

/** Native <dialog>: focus trapping, Escape to close and a backdrop come for free. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  confirmVariant = 'danger',
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  /** Red for things that cannot be undone; marigold for the happy path (publishing). */
  confirmVariant?: Variant;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close?.();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-lg border border-border bg-card p-6 text-card-foreground backdrop:bg-black/50"
      aria-labelledby="confirm-title"
    >
      {open && (
        <>
          <h2 id="confirm-title" className="text-lg">
            {title}
          </h2>
          <div className="mt-3">{children}</div>
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <Button onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button variant={confirmVariant} onClick={onConfirm} disabled={busy}>
              {busy ? 'Working…' : confirmLabel}
            </Button>
          </div>
        </>
      )}
    </dialog>
  );
}

/**
 * A plain window over the page: native <dialog>, so focus stays inside, Escape closes it and the page behind is inert.
 * Clicking the dimmed area closes it too. Its children are only rendered while it is open.
 */
export function Modal({ open, title, onClose, children, size = 'normal' }: { open: boolean; title: string; onClose: () => void; children: ReactNode; size?: 'normal' | 'wide' }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close?.();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      className={`m-auto max-h-[calc(100dvh-2rem)] ${size === 'wide' ? 'w-[min(48rem,calc(100%-2rem))]' : 'w-[min(36rem,calc(100%-2rem))]'} overflow-y-auto rounded-lg border border-border bg-card p-0 text-card-foreground backdrop:bg-black/50`}
    >
      {open && (
        <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <h2 id={titleId} className="text-lg">
              {title}
            </h2>
            <Button variant="ghost" className="-mt-1 -mr-2 px-3" aria-label="Close" onClick={onClose}>
              <Icon name="x" />
            </Button>
          </div>
          <div className="mt-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function PageHeading({ title, children, lead }: { title: string; children?: ReactNode; lead?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl">{title}</h1>
        {lead && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{lead}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
    </div>
  );
}
