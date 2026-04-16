import { createContext, useContext, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

const DialogContext = createContext(null);

export function Dialog({ open: openProp, onOpenChange, children }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = typeof openProp === 'boolean' ? openProp : internalOpen;

  const setOpen = (next) => {
    if (onOpenChange) {
      onOpenChange(next);
      return;
    }
    setInternalOpen(next);
  };

  const value = useMemo(() => ({ open, setOpen }), [open]);
  return <DialogContext.Provider value={value}>{children}</DialogContext.Provider>;
}

export function DialogContent({ className = '', children }) {
  const ctx = useContext(DialogContext);
  if (!ctx?.open) return null;

  const content = (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/45 p-4" onMouseDown={() => ctx.setOpen(false)}>
      <div
        className={`w-full max-w-lg rounded-lg border border-border bg-background p-5 text-foreground shadow-2xl ${className}`.trim()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

export function DialogHeader({ className = '', children }) {
  return <div className={`mb-3 space-y-1 ${className}`.trim()}>{children}</div>;
}

export function DialogTitle({ className = '', children }) {
  return <h2 className={`text-lg font-semibold text-foreground ${className}`.trim()}>{children}</h2>;
}

export function DialogDescription({ className = '', children }) {
  return <p className={`text-sm text-muted-foreground ${className}`.trim()}>{children}</p>;
}

export function DialogFooter({ className = '', children }) {
  return <div className={`mt-4 flex items-center justify-end gap-2 ${className}`.trim()}>{children}</div>;
}
