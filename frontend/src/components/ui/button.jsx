import { cloneElement, isValidElement } from 'react';

const VARIANT_CLASSES = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/85',
  outline: 'border border-border bg-background/70 text-foreground hover:bg-muted',
  ghost: 'bg-transparent text-foreground hover:bg-muted',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
};

const SIZE_CLASSES = {
  default: 'h-10 px-4 py-2 text-sm',
  sm: 'h-8 px-3 py-1 text-xs',
  lg: 'h-11 px-6 py-2 text-base',
  icon: 'h-9 w-9 p-0',
};

export function Button({
  variant = 'default',
  size = 'default',
  asChild = false,
  className = '',
  children,
  ...props
}) {
  const baseClass = [
    'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-50',
    VARIANT_CLASSES[variant] || VARIANT_CLASSES.default,
    SIZE_CLASSES[size] || SIZE_CLASSES.default,
    className,
  ].join(' ');

  if (asChild && isValidElement(children)) {
    return cloneElement(children, {
      ...props,
      className: `${baseClass} ${children.props.className || ''}`.trim(),
    });
  }

  return (
    <button type="button" className={baseClass} {...props}>
      {children}
    </button>
  );
}
