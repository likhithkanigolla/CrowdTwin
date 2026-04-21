import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ListChecks, History, Trash2, CheckCircle2, XCircle } from "lucide-react";

export default function ActionQueueAuditPanel({ config, audit }) {
  const [tab, setTab] = useState("queue");
  const suggestions = useMemo(() => buildSuggestions(config), [config]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <ListChecks className="h-4 w-4 text-primary" /> Action Queue & Audit
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant={tab === "queue" ? "secondary" : "ghost"} onClick={() => setTab("queue")}>Queue</Button>
          <Button size="sm" variant={tab === "audit" ? "secondary" : "ghost"} onClick={() => setTab("audit")}>Audit</Button>
        </div>
      </div>

      {tab === "queue" && (
        <div className="space-y-2">
          {suggestions.length === 0 && (
            <div className="ct-panel p-4 text-center text-xs text-muted-foreground">No suggested actions right now.</div>
          )}
          {suggestions.map((s) => (
            <div key={s.id} className="ct-panel space-y-1 p-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{s.title}</span>
                <span className="ct-chip ml-auto">{s.severity}</span>
              </div>
              <div className="text-[11px] text-muted-foreground">{s.reason}</div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => audit.log({ action: "suggestion.approve", target: s.id, after: s })}>
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Approve
                </Button>
                <Button size="sm" variant="ghost" onClick={() => audit.log({ action: "suggestion.reject", target: s.id, after: s })}>
                  <XCircle className="mr-1 h-3.5 w-3.5" /> Reject
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "audit" && (
        <div className="ct-panel max-h-72 overflow-auto p-2 text-xs">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="flex items-center gap-1 text-muted-foreground"><History className="h-3.5 w-3.5" /> {audit.entries.length} events</span>
            <Button size="sm" variant="ghost" onClick={audit.clear}><Trash2 className="mr-1 h-3.5 w-3.5" /> Clear</Button>
          </div>
          {audit.entries.length === 0 && <div className="p-3 text-center text-muted-foreground">No audit events yet.</div>}
          <ul className="space-y-1">
            {audit.entries.map((e) => (
              <li key={e.id} className="rounded-md border border-border/40 bg-background/30 p-2">
                <div className="flex items-center gap-2">
                  <span className="ct-mono text-[10px] text-muted-foreground">{new Date(e.timestamp).toLocaleTimeString()}</span>
                  <span className="ct-chip">{e.action}</span>
                  <span className="ct-mono text-[10px] text-muted-foreground">{e.target}</span>
                </div>
                {e.note && <div className="mt-1 text-[11px]">{e.note}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function buildSuggestions(config) {
  const out = [];
  for (const g of config.gates) {
    if (g.derivedRoadStatus === "red") {
      out.push({
        id: `s-${g.id}`,
        title: `Reroute around ${g.name}`,
        severity: "high",
        reason: "Both gate sides closed — broadcast diversion message on nearest display.",
      });
    } else if (g.derivedRoadStatus === "yellow") {
      out.push({
        id: `s-${g.id}`,
        title: `Monitor ${g.name}`,
        severity: "med",
        reason: "One side closed — reduced throughput.",
      });
    }
  }
  const conflicts = (config.timetables || []).filter((t) => t.status === "conflict");
  if (conflicts.length) {
    out.push({
      id: "s-tt-conflicts",
      title: `${conflicts.length} timetable conflicts`,
      severity: "med",
      reason: "Re-run room allocation or adjust expected strength.",
    });
  }
  return out;
}
