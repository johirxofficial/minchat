import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2 } from 'lucide-react';
import { avatarStyle, classNames, initials } from '../lib/utils';

export function Avatar({ name, src, size = 44, online, className, square = false, ring = false, alt }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  const showImage = src && !broken;
  return (
    <span
      className={classNames('avatar', square && 'avatar-square', ring && 'avatar-ring', className)}
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.36) }}
      aria-label={alt || name || 'Avatar'}
    >
      {showImage ? (
        <img src={src} alt={alt || name || ''} onError={() => setBroken(true)} loading="lazy" />
      ) : (
        <span className="avatar-initials" style={avatarStyle(name)} aria-hidden="true">
          {initials(name)}
        </span>
      )}
      {online !== undefined && online !== null && (
        <span className={classNames('avatar-dot', online ? 'is-online' : 'is-offline')} />
      )}
    </span>
  );
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  icon: Icon,
  className,
  type = 'button',
  ...props
}) {
  return (
    <button
      type={type}
      className={classNames('btn', `btn-${variant}`, `btn-${size}`, loading && 'is-loading', className)}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <Loader2 size={16} className="spin" /> : Icon ? <Icon size={16} /> : null}
      <span>{children}</span>
    </button>
  );
}

export function IconButton({ label, icon: Icon, size = 18, variant = 'ghost', className, badge, ...props }) {
  return (
    <button
      type="button"
      className={classNames('icon-btn', `icon-btn-${variant}`, className)}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon size={size} />
      {badge ? <span className="icon-badge">{badge > 99 ? '99+' : badge}</span> : null}
    </button>
  );
}

export function Spinner({ size = 20, label = 'Loading' }) {
  return (
    <span className="spinner" role="status" aria-label={label}>
      <Loader2 size={size} className="spin" />
    </span>
  );
}

export function PageLoader({ label = 'Loading MinChat…' }) {
  return (
    <div className="page-loader">
      <span className="brand-mark brand-mark-lg" aria-hidden="true">
        m
      </span>
      <div className="page-loader-text">
        <Spinner size={18} /> <span>{label}</span>
      </div>
    </div>
  );
}

export function Badge({ children, tone = 'neutral', className }) {
  return <span className={classNames('badge', `badge-${tone}`, className)}>{children}</span>;
}

export function Modal({ open, onClose, title, description, children, footer, size = 'md', closeOnBackdrop = true }) {
  const titleId = useId();
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = setTimeout(() => {
      const focusable = panelRef.current?.querySelector(
        'input, textarea, select, button:not([data-close]), [tabindex]:not([tabindex="-1"])'
      );
      focusable?.focus?.();
    }, 30);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      clearTimeout(timer);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        ref={panelRef}
        className={classNames('modal', `modal-${size}`)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p className="modal-desc">{description}</p> : null}
          </div>
          <IconButton label="Close" icon={X} onClick={onClose} data-close />
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  tone = 'danger',
  loading = false,
  children
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children || (
        <div className="confirm-illustration" aria-hidden="true">
          <span className="confirm-ring" />
          <span className="confirm-ring confirm-ring-2" />
          <span className="confirm-emoji">{tone === 'danger' ? '⚠️' : '💬'}</span>
        </div>
      )}
    </Modal>
  );
}

export function EmptyState({ icon: Icon, title, description, children, compact = false }) {
  return (
    <div className={classNames('empty-state', compact && 'empty-state-compact')}>
      {Icon ? (
        <span className="empty-icon" aria-hidden="true">
          <Icon size={26} />
        </span>
      ) : null}
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {children}
    </div>
  );
}

export function Field({ label, hint, error, htmlFor, children, optional }) {
  return (
    <label className={classNames('field', error && 'field-error')} htmlFor={htmlFor}>
      {label ? (
        <span className="field-label">
          {label}
          {optional ? <em>optional</em> : null}
        </span>
      ) : null}
      {children}
      {error ? <span className="field-msg field-msg-error">{error}</span> : null}
      {!error && hint ? <span className="field-msg">{hint}</span> : null}
    </label>
  );
}

export function Switch({ checked, onChange, label, description, disabled }) {
  return (
    <label className={classNames('switch-row', disabled && 'is-disabled')}>
      <span className="switch-copy">
        <span className="switch-label">{label}</span>
        {description ? <span className="switch-desc">{description}</span> : null}
      </span>
      <span className={classNames('switch', checked && 'is-on')}>
        <input
          type="checkbox"
          checked={Boolean(checked)}
          onChange={(event) => onChange?.(event.target.checked)}
          disabled={disabled}
        />
        <span className="switch-knob" />
      </span>
    </label>
  );
}

export function Segmented({ options, value, onChange, ariaLabel }) {
  return (
    <div className="segmented" role="tablist" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className={classNames('segment', value === option.value && 'is-active')}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count ? <span className="segment-count">{option.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Alert({ tone = 'info', children, title }) {
  return (
    <div className={classNames('alert', `alert-${tone}`)} role={tone === 'error' ? 'alert' : 'status'}>
      <div>
        {title ? <strong>{title}</strong> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}
