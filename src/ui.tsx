import React from 'react';

export type IconName =
  | 'library'
  | 'agenda'
  | 'atom'
  | 'bookmark'
  | 'annotated'
  | 'settings'
  | 'back'
  | 'search'
  | 'refresh'
  | 'export'
  | 'trash'
  | 'undo'
  | 'redo'
  | 'event'
  | 'open'
  | 'chevron'
  | 'plus'
  | 'minus'
  | 'pen'
  | 'text'
  | 'eraser'
  | 'check'
  | 'info'
  | 'dialog';

const iconPaths: Record<IconName, string> = {
  library:
    'M6 5.5h12A2.5 2.5 0 0 1 20.5 8v8A2.5 2.5 0 0 1 18 18.5H6A2.5 2.5 0 0 1 3.5 16V8A2.5 2.5 0 0 1 6 5.5Zm0 2A.5.5 0 0 0 5.5 8v8a.5.5 0 0 0 .5.5h12a.5.5 0 0 0 .5-.5V8a.5.5 0 0 0-.5-.5H6Zm2 2h8v2H8v-2Zm0 4h6v2H8v-2Z',
  agenda:
    'M6 5.5h12A2.5 2.5 0 0 1 20.5 8v8A2.5 2.5 0 0 1 18 18.5H6A2.5 2.5 0 0 1 3.5 16V8A2.5 2.5 0 0 1 6 5.5Zm0 2A.5.5 0 0 0 5.5 8v8a.5.5 0 0 0 .5.5h12a.5.5 0 0 0 .5-.5V8a.5.5 0 0 0-.5-.5H6Zm2 1.75h8v1.5H8v-1.5Zm0 3.25h8v1.5H8v-1.5Zm0 3.25h5v1.5H8v-1.5Z',
  atom: 'M12 10.6c-1.5 0-2.7.6-2.7 1.4s1.2 1.4 2.7 1.4 2.7-.6 2.7-1.4-1.2-1.4-2.7-1.4Zm0-3.6C8.6 7 6 8.9 6 11.8S8.6 16.5 12 16.5s6-1.8 6-4.7S15.4 7 12 7Zm0 2c2.2 0 4 .9 4 2.8s-1.8 2.8-4 2.8-4-.9-4-2.8S9.8 9 12 9Zm-4.7-2.3 1.3-1.3 8.4 8.4-1.3 1.3-8.4-8.4Zm0 8.4 8.4-8.4 1.3 1.3-8.4 8.4-1.3-1.3Z',
  bookmark:
    'M7 4.5h10A1.5 1.5 0 0 1 18.5 6v12l-6.5-3.5L5.5 18V6A1.5 1.5 0 0 1 7 4.5Zm0 2v8.15l4.5-2.43 4.5 2.43V6H7Z',
  annotated:
    'M7 4.5h10A1.5 1.5 0 0 1 18.5 6v6.1a4.6 4.6 0 0 0-2-1.23V6H7v12l2.3-1.24a4.6 4.6 0 0 0 1.02 1.71L7 21V6A1.5 1.5 0 0 1 8.5 4.5Zm7.8 9.2 1.15 1.15 3.15-3.15 1.05 1.05-4.2 4.2-2.2-2.2 1.05-1.05Z',
  settings:
    'M12 7.2a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6Zm0 1.8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm6.15 1.2.9 1.56-1.52 1.05c.03.18.05.36.05.55s-.02.37-.05.55l1.52 1.05-.9 1.56-1.8-.62a5.5 5.5 0 0 1-.95.55l-.33 1.88h-1.8l-.33-1.88a5.5 5.5 0 0 1-.95-.55l-1.8.62-.9-1.56 1.52-1.05a4.1 4.1 0 0 1 0-1.1l-1.52-1.05.9-1.56 1.8.62c.3-.22.62-.4.95-.55l.33-1.88h1.8l.33 1.88c.33.15.65.33.95.55l1.8-.62Z',
  back: 'M15.3 4.9 9.2 11l6.1 6.1-1.4 1.4-7.5-7.5 7.5-7.5 1.4 1.4Z',
  search:
    'M10.5 4.75a5.75 5.75 0 1 1 0 11.5 5.75 5.75 0 0 1 0-11.5Zm0 2a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5Zm5.18 7.76 3.82 3.82-1.41 1.41-3.82-3.82 1.41-1.41Z',
  refresh:
    'M17.35 8.65A6.5 6.5 0 1 0 18.5 12h-2a4.5 4.5 0 1 1-.83-2.6L14 11h5V6l-1.65 1.65Z',
  export: 'M12 4.5 16 8.5h-2.75V14h-2.5V8.5H8L12 4.5Zm-6 11h12v2H6v-2Z',
  trash:
    'M9.5 4.75h5l.75 1.25H19v2H5v-2h3.75l.75-1.25Zm-1 4.5h7l-.55 9.5A1.5 1.5 0 0 1 13.96 20h-3.92a1.5 1.5 0 0 1-1.49-1.25l-.55-9.5Zm2 2v5h1.5v-5h-1.5Zm3 0v5h1.5v-5h-1.5Z',
  undo: 'M10.2 7.3H15a4.8 4.8 0 1 1 0 9.6H7.4l2.2 2.2-1.4 1.4-4.6-4.6 4.6-4.6 1.4 1.4-2.2 2.2H15a2.8 2.8 0 1 0 0-5.6h-4.8v-2Z',
  redo: 'M13.8 7.3H9a4.8 4.8 0 1 0 0 9.6h7.6l-2.2 2.2 1.4 1.4 4.6-4.6-4.6-4.6-1.4 1.4 2.2 2.2H9a2.8 2.8 0 1 1 0-5.6h4.8v-2Z',
  event:
    'M6 5.5h12A2.5 2.5 0 0 1 20.5 8v8A2.5 2.5 0 0 1 18 18.5H6A2.5 2.5 0 0 1 3.5 16V8A2.5 2.5 0 0 1 6 5.5Zm0 2A.5.5 0 0 0 5.5 8v8a.5.5 0 0 0 .5.5h12a.5.5 0 0 0 .5-.5V8a.5.5 0 0 0-.5-.5H6Zm2 2h8v2H8v-2Zm0 4h5v2H8v-2Z',
  open: 'M7 5.5h10A1.5 1.5 0 0 1 18.5 7v10A1.5 1.5 0 0 1 17 18.5H7A1.5 1.5 0 0 1 5.5 17V7A1.5 1.5 0 0 1 7 5.5Zm0 2a.5.5 0 0 0-.5.5v9.5h11V8a.5.5 0 0 0-.5-.5H7Zm2 1.5h6v2H9V9Zm0 4h4v2H9v-2Z',
  chevron: 'M9.2 6.9 14.3 12l-5.1 5.1-1.4-1.4 3.7-3.7-3.7-3.7 1.4-1.4Z',
  plus: 'M11 5.5h2v13h-2v-13Zm-5.5 5.5h13v2h-13v-2Z',
  minus: 'M5.5 11h13v2h-13v-2Z',
  pen: 'M5.5 18.5 8 16l5.6-5.6 2.8 2.8L10.8 18H5.5v.5Zm9.6-7.6-2.8-2.8 1.2-1.2c.5-.5 1.2-.5 1.7 0l1.1 1.1c.5.5.5 1.2 0 1.7l-1.2 1.2Z',
  text: 'M6.5 6.5h11v2h-4v9h-3v-9h-4v-2Zm2.5 11.5h6v2H9v-2Z',
  eraser:
    'M7 16.5h9.4l2.1-2.1c.8-.8.8-2.1 0-2.9l-4.1-4.1c-.8-.8-2.1-.8-2.9 0L4.5 14.4c-.8.8-.8 2.1 0 2.9.3.2.7.3 1 .3H7Zm1.2-2L14 8.7l3.1 3.1-5.8 5.8H8.2Z',
  check: 'M10 16.2 5.8 12l1.4-1.4 2.8 2.8 6.8-6.8 1.4 1.4-8.2 8.2Z',
  info: 'M12 6.6a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8Zm-1 2.4h2v7h-2V9Z',
  dialog:
    'M6 5.5h12A2.5 2.5 0 0 1 20.5 8v8A2.5 2.5 0 0 1 18 18.5H6A2.5 2.5 0 0 1 3.5 16V8A2.5 2.5 0 0 1 6 5.5Zm0 2A.5.5 0 0 0 5.5 8v8a.5.5 0 0 0 .5.5h12a.5.5 0 0 0 .5-.5V8a.5.5 0 0 0-.5-.5H6Zm2 2h8v2H8v-2Z',
};

export function Icon({ name }: { name: IconName }) {
  if (name === 'atom') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="icon">
        <g
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <ellipse
            cx="12"
            cy="12"
            rx="8.2"
            ry="3.8"
            transform="rotate(45 12 12)"
            strokeWidth="1.8"
          />
          <ellipse
            cx="12"
            cy="12"
            rx="8.2"
            ry="3.8"
            transform="rotate(-45 12 12)"
            strokeWidth="1.8"
          />
          <circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none" />
        </g>
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="icon">
      <path d={iconPaths[name]} />
    </svg>
  );
}

export function IconButton({
  label,
  icon,
  title,
  onClick,
  onPointerDown,
  disabled,
  pressed,
}: {
  label: string;
  icon: IconName;
  title?: string;
  onClick?: () => void;
  onPointerDown?: React.PointerEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      className={`icon-button${pressed ? ' is-active' : ''}`}
      type="button"
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      onPointerDown={onPointerDown}
      disabled={disabled}
      aria-pressed={pressed}
    >
      <Icon name={icon} />
    </button>
  );
}

export function NavButton({
  active,
  label,
  shortLabel,
  icon,
  onClick,
}: {
  active?: boolean;
  label: string;
  shortLabel?: string;
  icon: IconName;
  onClick?: () => void;
}) {
  return (
    <button
      className={`shell-button${active ? ' is-active' : ''}`}
      type="button"
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon name={icon} />
      <span className="shell-button-label">
        <span className="shell-button-full">{label}</span>
        <span className="shell-button-short">{shortLabel ?? label}</span>
      </span>
    </button>
  );
}

export function PrimaryButton({
  children,
  icon,
  onClick,
  title,
  className = '',
  disabled = false,
}: {
  children: React.ReactNode;
  icon?: IconName;
  onClick?: () => void;
  title?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      className={`primary-button${className ? ` ${className}` : ''}`}
      type="button"
      title={title ?? (typeof children === 'string' ? children : undefined)}
      disabled={disabled}
      onClick={onClick}
    >
      {icon ? <Icon name={icon} /> : null}
      <span>{children}</span>
    </button>
  );
}

export function CommandBar({
  kicker,
  title,
  titleMeta,
  status,
  leading,
  actions,
}: {
  kicker: string;
  title: string;
  titleMeta?: React.ReactNode;
  status: React.ReactNode;
  leading?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="command-bar">
      <div className="command-bar-leading">
        {leading}
        <div className="command-title-group">
          {kicker ? <p className="command-kicker">{kicker}</p> : null}
          <div className="command-title-row">
            <h1 className="command-title">{title}</h1>
            {titleMeta ? (
              <span className="command-title-meta">{titleMeta}</span>
            ) : null}
          </div>
        </div>
        {status}
      </div>
      <div className="command-bar-actions">{actions}</div>
    </header>
  );
}

export function Row({
  title,
  meta,
  detail,
  action,
  onClick,
  selected = false,
  variant = 'surface',
  ariaLabel,
}: {
  title: string;
  meta?: React.ReactNode;
  detail?: React.ReactNode;
  action?: React.ReactNode;
  onClick?: () => void;
  selected?: boolean;
  variant?: 'surface' | 'list';
  ariaLabel?: string;
}) {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!onClick) {
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <article
      className={`row row-${variant}${selected ? ' is-selected' : ''}${onClick ? ' is-interactive' : ''}`}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={ariaLabel}
      aria-current={selected ? 'true' : undefined}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      <div className="row-main">
        <div className="row-title">{title}</div>
        {meta ? <div className="row-meta">{meta}</div> : null}
      </div>
      {detail ? <div className="row-detail">{detail}</div> : null}
      {action ? <div className="row-action">{action}</div> : null}
    </article>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ label: string; value: T; title?: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented-control" role="group" aria-label="View filter">
      {options.map((option) => (
        <button
          key={option.value}
          className={`segmented-control-option${value === option.value ? ' is-selected' : ''}`}
          type="button"
          aria-pressed={value === option.value}
          title={option.title ?? option.label}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function StatusLabel({
  label,
  tone = 'neutral',
  icon,
}: {
  label: string;
  tone?: 'neutral' | 'success' | 'warning' | 'error';
  icon?: IconName;
}) {
  return (
    <span className={`status-label tone-${tone}`}>
      {icon ? <Icon name={icon} /> : null}
      <span>{label}</span>
    </span>
  );
}

export function DetailsSurface({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const titleId = React.useId();
  const subtitleId = React.useId();

  return (
    <section
      className="details-surface"
      aria-labelledby={titleId}
      aria-describedby={subtitle ? subtitleId : undefined}
    >
      <div className="details-surface-header">
        <h2 id={titleId}>{title}</h2>
        {subtitle ? <p id={subtitleId}>{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function DialogSurface({
  title,
  body,
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
}: {
  title: string;
  body: React.ReactNode;
  primaryLabel: string;
  secondaryLabel: string;
  onPrimary?: () => void;
  onSecondary?: () => void;
}) {
  const titleId = React.useId();
  const bodyId = React.useId();

  return (
    <section
      className="dialog-surface"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
    >
      <div className="dialog-surface-header">
        <div className="dialog-surface-title">
          <Icon name="dialog" />
          <h3 id={titleId}>{title}</h3>
        </div>
        <div id={bodyId} className="dialog-surface-body">
          {body}
        </div>
      </div>
      <div className="dialog-surface-actions">
        <button
          className="secondary-button"
          type="button"
          onClick={onSecondary}
        >
          {secondaryLabel}
        </button>
        <button className="primary-button" type="button" onClick={onPrimary}>
          {primaryLabel}
        </button>
      </div>
    </section>
  );
}

export function ThemePreview({
  theme,
  children,
}: {
  theme: 'light' | 'dark';
  children: React.ReactNode;
}) {
  return (
    <section className={`theme-preview theme-${theme}`}>{children}</section>
  );
}
