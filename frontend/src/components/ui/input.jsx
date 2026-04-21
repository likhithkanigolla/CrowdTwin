export function Input({ className = '', ...props }) {
  return (
    <input
      className={`w-full rounded-md border border-input bg-background/75 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${className}`.trim()}
      {...props}
    />
  );
}
