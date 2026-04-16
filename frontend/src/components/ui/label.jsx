export function Label({ className = '', children, ...props }) {
  return (
    <label className={`text-xs font-semibold text-foreground/85 ${className}`.trim()} {...props}>
      {children}
    </label>
  );
}
