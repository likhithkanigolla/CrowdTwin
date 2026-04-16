import { useCallback, useMemo, useState } from 'react';

const MAX_ENTRIES = 400;

export function useAuditLog() {
  const [entries, setEntries] = useState([]);

  const log = useCallback((entry) => {
    const next = {
      id: `audit-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      action: String(entry?.action || 'unknown.action'),
      target: String(entry?.target || 'unknown-target'),
      note: entry?.note || null,
      before: entry?.before,
      after: entry?.after,
    };

    setEntries((prev) => [next, ...prev].slice(0, MAX_ENTRIES));
  }, []);

  const clear = useCallback(() => {
    setEntries([]);
  }, []);

  return useMemo(() => ({ entries, log, clear }), [entries, log, clear]);
}
