import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Bot, Plus, Trash2, Power } from "lucide-react";

const METRICS = ["gate.density", "gate.queueLen", "campus.crowd", "weather.severity"];
const ACTIONS = ["set-display-mode", "close-gate-side", "broadcast-message"];
const OPS = [">", ">=", "<", "<=", "==", "!="];

export default function RuleAutomationPanel({ config, store, audit }) {
  const [draft, setDraft] = useState(emptyRule());

  const setRules = (rules) => store.setRules(config.id, rules);

  const addRule = () => {
    if (!draft.name.trim()) return;
    const rule = { ...draft, id: `rule-${Date.now()}` };
    setRules([...(config.rules || []), rule]);
    audit.log({ action: "rule.create", target: rule.id, after: rule });
    setDraft(emptyRule());
  };

  const removeRule = (id) => {
    const before = config.rules.find((r) => r.id === id);
    setRules(config.rules.filter((r) => r.id !== id));
    audit.log({ action: "rule.delete", target: id, before });
  };

  const toggle = (id) => {
    const before = config.rules.find((r) => r.id === id);
    const after = { ...before, enabled: !before.enabled };
    setRules(config.rules.map((r) => (r.id === id ? after : r)));
    audit.log({ action: "rule.toggle", target: id, before, after });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Bot className="h-4 w-4 text-primary" /> Automation Rules
      </div>

      <div className="ct-panel space-y-2 p-3">
        <Label className="text-xs">New rule</Label>
        <div className="grid grid-cols-12 gap-2">
          <Input className="col-span-12 h-8" placeholder="Rule name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />

          <select className="col-span-4 h-8 rounded-md border border-border bg-background px-2 text-xs"
            value={draft.condition.metric}
            onChange={(e) => setDraft({ ...draft, condition: { ...draft.condition, metric: e.target.value } })}>
            {METRICS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select className="col-span-2 h-8 rounded-md border border-border bg-background px-2 text-xs"
            value={draft.condition.op}
            onChange={(e) => setDraft({ ...draft, condition: { ...draft.condition, op: e.target.value } })}>
            {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <Input className="col-span-3 h-8" type="number" step="0.01" value={draft.condition.value}
            onChange={(e) => setDraft({ ...draft, condition: { ...draft.condition, value: Number(e.target.value) } })} />
          <Input className="col-span-3 h-8" placeholder="target id"
            value={draft.condition.target}
            onChange={(e) => setDraft({ ...draft, condition: { ...draft.condition, target: e.target.value } })} />

          <select className="col-span-5 h-8 rounded-md border border-border bg-background px-2 text-xs"
            value={draft.action.type}
            onChange={(e) => setDraft({ ...draft, action: { ...draft.action, type: e.target.value } })}>
            {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <Input className="col-span-4 h-8" placeholder="action target id"
            value={draft.action.target}
            onChange={(e) => setDraft({ ...draft, action: { ...draft.action, target: e.target.value } })} />
          <select className="col-span-3 h-8 rounded-md border border-border bg-background px-2 text-xs"
            value={draft.approval}
            onChange={(e) => setDraft({ ...draft, approval: e.target.value })}>
            <option value="manual">manual</option>
            <option value="auto">auto</option>
          </select>

          <Input className="col-span-12 h-8" placeholder="action message / value"
            value={draft.action.value || ""}
            onChange={(e) => setDraft({ ...draft, action: { ...draft.action, value: e.target.value } })} />

          <div className="col-span-12 flex justify-end">
            <Button size="sm" onClick={addRule}><Plus className="mr-1 h-3.5 w-3.5" /> Add rule</Button>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {(config.rules || []).map((r) => (
          <div key={r.id} className="ct-panel space-y-1 p-3">
            <div className="flex items-center gap-2">
              <Power className={`h-4 w-4 ${r.enabled ? "text-status-green" : "text-muted-foreground"}`} />
              <span className="text-sm font-medium">{r.name}</span>
              <span className="ct-chip ml-auto">{r.approval}</span>
              <Switch checked={r.enabled} onCheckedChange={() => toggle(r.id)} />
              <Button size="icon" variant="ghost" onClick={() => removeRule(r.id)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
            <div className="ct-mono text-[11px] text-muted-foreground">
              IF {r.condition.metric}({r.condition.target}) {r.condition.op} {r.condition.value}{" "}
              → {r.action.type}({r.action.target}) {r.action.value ? `= "${r.action.value}"` : ""}
            </div>
          </div>
        ))}
        {(!config.rules || config.rules.length === 0) && (
          <div className="ct-panel p-4 text-center text-xs text-muted-foreground">No rules configured.</div>
        )}
      </div>
    </div>
  );
}

function emptyRule() {
  return {
    name: "",
    condition: { metric: "gate.density", target: "", op: ">", value: 0.8 },
    action: { type: "set-display-mode", target: "", value: "" },
    enabled: true,
    approval: "manual",
  };
}
