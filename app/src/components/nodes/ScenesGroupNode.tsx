// app/src/components/nodes/ScenesGroupNode.tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Layers, Maximize2 } from "lucide-react";
import type { SceneData, SceneRuntimeInfo } from "../../types/studio";

export interface ScenesGroupNodeData extends Record<string, unknown> {
  scenes: SceneData[];
  sceneRuntime: Record<string, SceneRuntimeInfo>;
  mediaRevision: number;
  approvedCount: number;
  pendingCount: number;
  staleCount: number;
  onExpand: () => void;
  onOpenPreview: (sceneId: string) => void;
}

function normalizeThemeClass(theme: string): string {
  if (theme === "carvao") return "theme-carvao";
  if (theme === "azul_marinho") return "theme-azul_marinho";
  return "theme-pergaminho";
}

export function ScenesGroupNode({ data }: NodeProps) {
  const d = data as unknown as ScenesGroupNodeData;
  const total = d.scenes.length;
  const previewScenes = d.scenes.slice(0, 4);
  const remainingCount = Math.max(0, total - previewScenes.length);
  const hasStale = d.staleCount > 0;
  const allApproved = total > 0 && d.approvedCount === total && !hasStale;

  return (
    <div
      className={`studio-node scenes-group-card ${
        hasStale
          ? "node-status-stale"
          : allApproved
            ? "node-status-ok"
            : "node-status-active"
      }`}
      data-testid="node-scenes-group"
    >
      <Handle type="target" position={Position.Left} id="group-in" />

      <div className="node-header">
        <div className="node-title-group">
          <span className="node-step-badge">04</span>
          <Layers size={14} color="#E5A93C" />
          <span className="node-title">Cenas 9:16 ({total})</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {hasStale && (
            <span className="pill pill-stale">{d.staleCount} desatual.</span>
          )}
          <span className={`pill ${allApproved ? "pill-ok" : "pill-gold"}`}>
            {d.approvedCount}/{total} OK
          </span>
        </div>
      </div>

      <div className="node-body nodrag nowheel">
        <div className="group-stats-row">
          <div className="group-stat-chip ok">
            <span className="group-stat-num">{d.approvedCount}</span>
            <span>Aprovadas</span>
          </div>
          <div className="group-stat-chip">
            <span className="group-stat-num">{d.pendingCount}</span>
            <span>Pendentes</span>
          </div>
          <div className={`group-stat-chip ${hasStale ? "stale" : ""}`}>
            <span className="group-stat-num">{d.staleCount}</span>
            <span>Desatual.</span>
          </div>
        </div>

        <div className="group-thumbs-grid">
          {previewScenes.map((scene) => {
            const rt = d.sceneRuntime[scene.scene_id];
            const thumbSrc = rt?.thumbnail_url
              ? `${rt.thumbnail_url}${rt.thumbnail_url.includes("?") ? "&" : "?"}v=${d.mediaRevision}`
              : null;
            return (
              <button
                key={scene.scene_id}
                type="button"
                className={`group-thumb-cell ${rt?.is_stale ? "stale" : ""}`}
                title={`Abrir preview de ${scene.scene_id.toUpperCase()}: ${scene.visual.headline}`}
                onClick={() => d.onOpenPreview(scene.scene_id)}
              >
                {thumbSrc ? (
                  <img
                    src={thumbSrc}
                    alt={scene.scene_id}
                    className="scene-thumb-img"
                  />
                ) : (
                  <div
                    className={`scene-thumb-fallback ${normalizeThemeClass(
                      scene.visual.background_theme
                    )}`}
                  >
                    <span className="scene-thumb-ratio">
                      {scene.scene_id.replace("scene_", "S")}
                    </span>
                  </div>
                )}
                <span className="group-thumb-label">
                  {scene.scene_id.replace("scene_", "#")}
                </span>
              </button>
            );
          })}
        </div>

        {remainingCount > 0 && (
          <div
            className="mono"
            style={{
              fontSize: 10.5,
              color: "var(--text-muted)",
              textAlign: "center",
            }}
          >
            +{remainingCount} cena(s) recolhida(s) neste grupo
          </div>
        )}
      </div>

      <div className="node-footer nodrag nowheel">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          style={{ width: "100%" }}
          data-testid="btn-expand-scenes-group"
          onClick={d.onExpand}
        >
          <Maximize2 size={13} />
          Expandir Cenas
        </button>
      </div>

      <Handle type="source" position={Position.Right} id="group-out" />
    </div>
  );
}
