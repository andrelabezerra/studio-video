// app/src/components/nodes/SceneNode.tsx
import { useEffect, useRef, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Check,
  Copy,
  ImagePlus,
  Play,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import type { SceneData } from "../../types/studio";

export interface SceneNodeData extends Record<string, unknown> {
  scene: SceneData;
  isStale?: boolean;
  thumbnailUrl?: string | null;
  mediaRevision: number;
  isSelected?: boolean;
  busyRegen: boolean;
  busyAsset: boolean;
  busyApprove: boolean;
  onSelectScene?: (sceneId: string) => void;
  onOpenPreview: (sceneId: string) => void;
  onRegenerate: (sceneId: string) => Promise<void>;
  onApprove: (sceneId: string) => Promise<void>;
  onUploadAsset: (sceneId: string, file: File, assetId?: string) => Promise<void>;
  onCopyPrompt: (prompt: string) => void;
}

const TEMPLATE_LABELS: Record<string, string> = {
  kinetic_captions: "kinetic_captions",
  paper_collage: "paper_collage",
  bible_quote_card: "bible_quote_card",
  timeline_map: "timeline_map",
  tier2_video: "tier2_video",
};

const STATUS_CLASS: Record<string, string> = {
  approved: "pill-ok",
  rendered: "pill-ok",
  draft: "pill-gold",
  needs_revision: "pill-alert",
  discarded: "",
};

function normalizeThemeClass(theme: string): string {
  if (theme === "carvao") return "theme-carvao";
  if (theme === "azul_marinho") return "theme-azul_marinho";
  return "theme-pergaminho";
}

export function SceneNode({ data }: NodeProps) {
  const d = data as unknown as SceneNodeData;
  const { scene } = d;
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [thumbError, setThumbError] = useState(false);

  useEffect(() => {
    setThumbError(false);
  }, [d.thumbnailUrl, d.mediaRevision]);

  const startMs = scene.timing.resolved_start_ms;
  const endMs = scene.timing.resolved_end_ms;
  const durationLabel =
    startMs !== null && endMs !== null && endMs > startMs
      ? `${((endMs - startMs) / 1000).toFixed(1)}s`
      : "3.5s";

  const primaryAsset = scene.assets[0];
  const promptText =
    primaryAsset?.prompt ||
    `Editorial Vox style paper collage cutout for '${scene.visual.headline}', warm parchment tones, torn edges, subtle drop shadow`;

  const handleFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    await d.onUploadAsset(scene.scene_id, file, primaryAsset?.asset_id);
  };

  const isDone = scene.status === "approved" || scene.status === "rendered";
  const isStale = Boolean(d.isStale);
  const openPinsCount = (scene.review_pins || []).filter((p) => !p.resolved).length;
  const thumbSrc =
    d.thumbnailUrl && !thumbError
      ? `${d.thumbnailUrl}${d.thumbnailUrl.includes("?") ? "&" : "?"}v=${d.mediaRevision}`
      : null;

  return (
    <div
      className={`studio-node scene-node-card ${
        isStale
          ? "node-status-stale"
          : isDone
            ? "node-status-ok"
            : "node-status-active"
      }${d.isSelected ? " scene-node-selected" : ""}`}
      data-testid={`node-${scene.scene_id}`}
      data-stale={isStale ? "true" : "false"}
      data-selected={d.isSelected ? "true" : "false"}
      onClick={() => d.onSelectScene?.(scene.scene_id)}
    >
      <Handle type="target" position={Position.Left} id="scene-in" />

      <div className="node-header">
        <div className="node-title-group">
          <span className="node-step-badge">{scene.scene_id.toUpperCase()}</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--text-secondary)" }}>
            {durationLabel}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {openPinsCount > 0 && (
            <span
              className="pill pill-pin"
              data-testid={`badge-pins-${scene.scene_id}`}
              title={`${openPinsCount} pin(s) de revisão aberto(s)`}
            >
              📍 {openPinsCount} {openPinsCount === 1 ? "pin" : "pins"}
            </span>
          )}
          {isStale && <span className="pill pill-stale">desatualizado</span>}
          <span className={`pill ${STATUS_CLASS[scene.status] || ""}`}>
            {scene.status}
          </span>
        </div>
      </div>

      <div className="node-body nodrag nowheel">
        {/* Bloco Hero: Miniatura 9:16 real + Metadados */}
        <div className="scene-hero-row">
          <button
            type="button"
            className="scene-thumb-frame"
            title={`Abrir Preview Ao Vivo de ${scene.scene_id.toUpperCase()}`}
            data-testid={`thumb-${scene.scene_id}`}
            onClick={(e) => {
              e.stopPropagation();
              d.onSelectScene?.(scene.scene_id);
              d.onOpenPreview(scene.scene_id);
            }}
          >
            {thumbSrc ? (
              <img
                src={thumbSrc}
                alt={scene.scene_id}
                className="scene-thumb-img"
                onError={() => setThumbError(true)}
              />
            ) : (
              <div
                className={`scene-thumb-fallback ${normalizeThemeClass(
                  scene.visual.background_theme
                )}`}
              >
                <span className="scene-thumb-ratio">9:16</span>
                <span className="scene-thumb-fallback-title">
                  {scene.visual.headline || scene.scene_id}
                </span>
                <span className="scene-thumb-fallback-tpl">
                  {scene.template}
                </span>
              </div>
            )}
            <span className="scene-thumb-overlay" aria-hidden="true">
              <Play size={14} />
            </span>
          </button>

          <div className="scene-hero-info">
            <div className="scene-meta-row">
              <span className="pill pill-blue">
                {TEMPLATE_LABELS[scene.template] || scene.template}
              </span>
              <span className="pill">{scene.visual.background_theme}</span>
              <span className="pill" title="Transição e movimento de câmera">
                {scene.visual.transition_in} · {scene.visual.camera_motion || "subtle_zoom_in"}
              </span>
            </div>

            <div>
              <div className="scene-headline" title={scene.visual.headline}>
                {scene.visual.headline || "Sem título"}
              </div>
              {scene.visual.subtext && (
                <div className="scene-subtext" title={scene.visual.subtext}>
                  {scene.visual.subtext}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Dropzone Gemini PRO + Prompt Pack */}
        <div className="scene-asset-row">
          <div
            className={`dropzone scene-dropzone-compact ${dragging ? "dragging" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              fileRef.current?.click();
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void handleFiles(e.dataTransfer.files);
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => void handleFiles(e.target.files)}
            />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
              }}
            >
              <ImagePlus size={12} color="#E5A93C" />
              <span>
                {d.busyAsset
                  ? "Processando..."
                  : primaryAsset?.cache_relpath
                    ? "Arte anexada (trocar)"
                    : "Dropzone Gemini PRO"}
              </span>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-xs"
            title="Copiar prompt editorial da cena"
            onClick={(e) => {
              e.stopPropagation();
              d.onCopyPrompt(promptText);
            }}
          >
            <Copy size={11} />
            Prompt
          </button>
        </div>

        {/* Ações da Cena */}
        <div className="scene-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            style={{ gridColumn: "1 / -1" }}
            onClick={(e) => {
              e.stopPropagation();
              d.onSelectScene?.(scene.scene_id);
              d.onOpenPreview(scene.scene_id);
            }}
          >
            <SlidersHorizontal size={13} />
            Editar Cena & Preview
          </button>

          <button
            type="button"
            className="btn btn-sm"
            disabled={d.busyRegen}
            onClick={(e) => {
              e.stopPropagation();
              d.onSelectScene?.(scene.scene_id);
              void d.onRegenerate(scene.scene_id);
            }}
          >
            <RefreshCw size={12} />
            {d.busyRegen ? "Render..." : "Regenerar"}
          </button>

          <button
            type="button"
            className={`btn btn-sm ${isDone ? "btn-success" : ""}`}
            disabled={d.busyApprove}
            onClick={(e) => {
              e.stopPropagation();
              d.onSelectScene?.(scene.scene_id);
              void d.onApprove(scene.scene_id);
            }}
          >
            <Check size={12} />
            {isDone ? "Aprovada" : "Aprovar"}
          </button>
        </div>
      </div>

      <Handle type="source" position={Position.Right} id="scene-out" />
    </div>
  );
}
