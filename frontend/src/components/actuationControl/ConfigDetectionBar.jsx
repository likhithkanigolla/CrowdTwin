import { useMemo } from "react";
import { findNearestConfig, formatMeters } from "@/utils/geo";
import { Button } from "@/components/ui/button";
import { MapPin, Plus, Crosshair } from "lucide-react";

function formatCoord(value, digits = 5) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "--";
}

// Compact variant designed to live inside the floating top bar.
export default function ConfigDetectionBar({
  configs,
  cursor,
  activeConfigId,
  onSelectConfig,
  onCreateConfig,
}) {
  const nearest = useMemo(() => (cursor ? findNearestConfig(cursor, configs) : null), [cursor, configs]);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Crosshair className="h-3.5 w-3.5 text-primary" />
      <span className="ct-mono text-muted-foreground">
        {cursor ? `${formatCoord(cursor.lat)}, ${formatCoord(cursor.lng)}` : "click map to probe"}
      </span>

      {nearest && (
        <>
          <span className="ct-chip">
            <MapPin className="h-3 w-3" /> {nearest.config.campusName}
          </span>
          <span className="text-muted-foreground">
            {formatMeters(nearest.distance)} · r={nearest.config.radiusMeters}m
          </span>
          {nearest.withinRadius ? (
            <span className="ct-chip border-status-green/40 text-status-green">
              <span className="ct-status-dot ct-status-green" /> inside
            </span>
          ) : (
            <span className="ct-chip border-status-yellow/40 text-status-yellow">
              <span className="ct-status-dot ct-status-yellow" /> outside
            </span>
          )}
          {nearest.config.id !== activeConfigId && nearest.withinRadius && (
            <Button size="sm" variant="secondary" onClick={() => onSelectConfig(nearest.config.id)}>
              Load
            </Button>
          )}
          {!nearest.withinRadius && (
            <Button size="sm" onClick={() => onCreateConfig(cursor)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> New here
            </Button>
          )}
        </>
      )}

      <span className="text-muted-foreground">·</span>
      <select
        value={activeConfigId || ""}
        onChange={(e) => onSelectConfig(e.target.value)}
        className="rounded-md border border-border bg-background px-2 py-1 text-xs"
      >
        {configs.length === 0 && <option value="">— none —</option>}
        {configs.map((c) => (
          <option key={c.id} value={c.id}>{c.campusName}</option>
        ))}
      </select>
      <Button size="sm" variant="outline" onClick={() => onCreateConfig(cursor)}>
        <Plus className="mr-1 h-3.5 w-3.5" /> New
      </Button>
    </div>
  );
}
