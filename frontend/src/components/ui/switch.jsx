export function Switch({ checked = false, onCheckedChange, className = '', ...props }) {
  const isChecked = Boolean(checked);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isChecked}
      className={`relative inline-flex h-6 w-11 items-center rounded-full border border-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${isChecked ? 'bg-primary' : 'bg-muted'} ${className}`.trim()}
      onClick={() => onCheckedChange?.(!isChecked)}
      {...props}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${isChecked ? 'translate-x-5' : 'translate-x-0'}`.trim()}
      />
    </button>
  );
}
