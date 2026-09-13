import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Slot } from '@radix-ui/react-slot';
import { CircleAlert, Inbox, LoaderCircle, X, type LucideIcon } from 'lucide-react';
import {
  cloneElement,
  forwardRef,
  isValidElement,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  busy?: boolean;
  icon?: LucideIcon;
  size?: 'sm' | 'md' | 'lg' | 'icon';
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    asChild,
    busy = false,
    children,
    className,
    disabled,
    icon: Icon,
    size = 'md',
    variant = 'primary',
    ...props
  },
  ref,
) {
  const classes = cn('ui-button', `ui-button--${variant}`, `ui-button--${size}`, className);
  if (asChild && isValidElement(children)) {
    const child = children as ReactElement<{ children?: ReactNode }>;
    return (
      <Slot
        aria-disabled={disabled || busy || undefined}
        className={classes}
        onClick={(event) => {
          if (disabled || busy) event.preventDefault();
          else props.onClick?.(event as unknown as React.MouseEvent<HTMLButtonElement>);
        }}
        ref={ref}
        tabIndex={disabled || busy ? -1 : props.tabIndex}
      >
        {cloneElement(
          child,
          undefined,
          busy ? (
            <>
              <LoaderCircle aria-hidden="true" className="ui-spin" size={18} />
              {child.props.children}
            </>
          ) : Icon ? (
            <>
              <Icon aria-hidden="true" size={18} />
              {child.props.children}
            </>
          ) : (
            child.props.children
          ),
        )}
      </Slot>
    );
  }
  return (
    <button className={classes} disabled={disabled || busy} ref={ref} {...props}>
      {busy ? (
        <LoaderCircle aria-hidden="true" className="ui-spin" size={18} />
      ) : Icon ? (
        <Icon aria-hidden="true" size={18} />
      ) : null}
      <span>{children}</span>
    </button>
  );
});

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('ui-card', className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('ui-card__header', className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('ui-card__content', className)} {...props} />;
}

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  hint?: string;
  label: string;
  leading?: ReactNode;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { className, error, hint, id, label, leading, ...props },
  ref,
) {
  const fieldId = id ?? props.name;
  const descriptionId = fieldId ? `${fieldId}-description` : undefined;
  return (
    <label className={cn('ui-field', className)} htmlFor={fieldId}>
      <span className="ui-field__label">{label}</span>
      <span className={cn('ui-field__control', error && 'ui-field__control--error')}>
        {leading && <span className="ui-field__leading">{leading}</span>}
        <input
          aria-describedby={hint || error ? descriptionId : undefined}
          aria-invalid={Boolean(error)}
          id={fieldId}
          ref={ref}
          {...props}
        />
      </span>
      {(error || hint) && (
        <span
          className={cn('ui-field__description', error && 'ui-field__description--error')}
          id={descriptionId}
        >
          {error ?? hint}
        </span>
      )}
    </label>
  );
});

export interface SelectFieldProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: string;
  hint?: string;
  label: string;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { children, className, error, hint, id, label, ...props },
  ref,
) {
  const fieldId = id ?? props.name;
  const descriptionId = fieldId ? `${fieldId}-description` : undefined;
  return (
    <label className={cn('ui-field', className)} htmlFor={fieldId}>
      <span className="ui-field__label">{label}</span>
      <select
        aria-describedby={hint || error ? descriptionId : undefined}
        aria-invalid={Boolean(error)}
        className={cn('ui-select', error && 'ui-field__control--error')}
        id={fieldId}
        ref={ref}
        {...props}
      >
        {children}
      </select>
      {(error || hint) && (
        <span
          className={cn('ui-field__description', error && 'ui-field__description--error')}
          id={descriptionId}
        >
          {error ?? hint}
        </span>
      )}
    </label>
  );
});

export function StatusBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'positive' | 'negative' | 'warning' | 'info' | 'neutral';
}) {
  return <span className={cn('ui-status', `ui-status--${tone}`)}>{children}</span>;
}

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn('ui-skeleton', className)} {...props} />;
}

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div aria-live="polite" className="ui-state ui-state--loading" role="status">
      <LoaderCircle aria-hidden="true" className="ui-spin" size={22} />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  action,
  description,
  icon: Icon = Inbox,
  title,
}: {
  action?: ReactNode;
  description: string;
  icon?: LucideIcon;
  title: string;
}) {
  return (
    <div className="ui-empty">
      <span className="ui-empty__icon">
        <Icon aria-hidden="true" size={24} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && <div className="ui-empty__action">{action}</div>}
    </div>
  );
}

export function ErrorState({
  action,
  description,
  title = 'Something went wrong',
}: {
  action?: ReactNode;
  description: string;
  title?: string;
}) {
  return (
    <div className="ui-error" role="alert">
      <CircleAlert aria-hidden="true" size={22} />
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
        {action && <div className="ui-error__action">{action}</div>}
      </div>
    </div>
  );
}

export interface ModalProps {
  children: ReactNode;
  description?: string;
  onOpenChange?: (open: boolean) => void;
  open: boolean;
  title: string;
}

export function Modal({ children, description, onOpenChange, open, title }: ModalProps) {
  return (
    <DialogPrimitive.Root onOpenChange={onOpenChange} open={open}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="ui-dialog__overlay" />
        <DialogPrimitive.Content className="ui-dialog__content">
          <div className="ui-dialog__heading">
            <div>
              <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description>{description}</DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close asChild>
              <Button aria-label="Close dialog" size="icon" variant="ghost">
                <X aria-hidden="true" size={20} />
              </Button>
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
