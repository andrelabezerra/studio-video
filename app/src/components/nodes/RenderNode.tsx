// app/src/components/nodes/RenderNode.tsx
import { useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  CheckCircle2,
  Circle,
  Copy,
  Film,
  Grid,
  Image as ImageIcon,
  Rocket,
  X,
} from "lucide-react";
import type {
  DistributionPack,
  ProjectArtifacts,
  ProjectGates,
} from "../../types/studio";
import type { RenderProgressState } from "../../hooks/useStudioProject";

export interface RenderNodeData extends Record<string, unknown> {
  gates: ProjectGates;
  artifacts: ProjectArtifacts;
  distributionPack: DistributionPack | null;
  renderProgress: RenderProgressState;
  mediaRevision: number;
  isStale?: boolean;
  hasScenes?: boolean;
  busyPreview: boolean;
  busyFinal: boolean;
  busyCover: boolean;
  onStartRender: (profile: "preview" | "final") => Promise<void>;
  onGenerateCover: () => Promise<void>;
  onCopyText: (label: string, text: string) => void;
}

const GATE_LIST: Array<{ key: keyof ProjectGates; label: string }> = [
  { key: "briefing_approved", label: "Briefing" },
  { key: "scripture_verified", label: "Rigor Bíblico" },
  { key: "script_gate_1_approved", label: "Gate 1 Roteiro" },
  { key: "audio_aligned", label: "Áudio word_id" },
  { key: "scenes_approved", label: "Cenas 9:16" },
  { key: "qa_passed", label: "QA Final" },
];

export function RenderNode({ data }: NodeProps) {
  const d = data as unknown as RenderNodeData;
  const [sheetOpen, setSheetOpen] = useState(false);

  const activeVideoUrl = d.artifacts.has_final_mp4
    ? d.artifacts.final_mp4_url
    : d.artifacts.has_preview_mp4
      ? d.artifacts.preview_mp4_url
      : null;

  const videoSrc = activeVideoUrl
    ? `${activeVideoUrl}?v=${d.mediaRevision}`
    : null;
  const contactSheetSrc = d.artifacts.contact_sheet_url
    ? `${d.artifacts.contact_sheet_url}?v=${d.mediaRevision}`
    : null;
  const coverSrc = d.artifacts.cover_url
    ? `${d.artifacts.cover_url}?v=${d.mediaRevision}`
    : null;

  const pack = d.distributionPack;
  const showStale = Boolean(d.isStale && d.hasScenes);

  return (
    <div
      className={`studio-node ${
        showStale ? "node-status-stale" : d.gates.qa_passed ? "node-status-ok" : ""
      }`}
      style={{ width: 420 }}
      data-testid="node-render"
    >
      <Handle type="target" position={Position.Left} id="render-in" />

      <div className="node-header">
        <div className="node-title-group">
          <span className="node-step-badge">05</span>
          <Rocket size={14} color="#E5A93C" />
          <span className="node-title">Render &amp; Empacotamento</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {showStale && <span className="pill pill-stale">desatualizado</span>}
          {d.artifacts.has_final_mp4 ? (
            <span className="pill pill-ok">1080×1920 OK</span>
          ) : d.artifacts.has_preview_mp4 ? (
            <span className="pill pill-gold">PREVIEW OK</span>
          ) : (
            <span className="pill">PENDENTE</span>
          )}
        </div>
      </div>

      <div className="node-body nodrag nowheel">
        {/* Checklist dos Gates */}
        <div>
          <div className="field-label">Checklist de Governança (Gates)</div>
          <div className="gate-checklist">
            {GATE_LIST.map((g) => {
              const passed = Boolean(d.gates[g.key]);
              return (
                <div
                  key={g.key}
                  className={`gate-item ${passed ? "passed" : ""}`}
                >
                  {passed ? <CheckCircle2 size={12} /> : <Circle size={12} />}
                  <span>{g.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Barra de Progresso SSE */}
        <div>
          <div className="field-label">
            <span>Progresso SSE ({d.renderProgress.stage})</span>
            <span className="mono">{Math.round(d.renderProgress.progressPct)}%</span>
          </div>
          <div className="progress-track">
            <div
              className={`progress-fill ${
                d.renderProgress.progressPct >= 100 ? "done" : ""
              }`}
              style={{ width: `${Math.min(100, Math.max(0, d.renderProgress.progressPct))}%` }}
            />
          </div>
          <div
            style={{
              marginTop: 4,
              fontSize: 11,
              color: d.renderProgress.error ? "#ff8c7d" : "var(--text-secondary)",
            }}
          >
            {d.renderProgress.message}
          </div>
        </div>

        {/* Botões de Render */}
        <div className="grid-2">
          <button
            type="button"
            className="btn"
            disabled={d.busyPreview || d.renderProgress.active}
            onClick={() => void d.onStartRender("preview")}
          >
            <Film size={13} />
            Render Preview (540×960)
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={d.busyFinal || d.renderProgress.active}
            onClick={() => void d.onStartRender("final")}
          >
            <Rocket size={13} />
            Render Final (1080×1920)
          </button>
        </div>

        {/* Player 9:16 + Contact Sheet */}
        {videoSrc && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="video-preview-wrap">
              <video
                className="video-preview-9x16"
                controls
                playsInline
                src={videoSrc}
                preload="metadata"
              />
            </div>
            {contactSheetSrc && d.artifacts.has_contact_sheet && (
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-xs"
                  style={{ flex: 1 }}
                  onClick={() => setSheetOpen(true)}
                >
                  <Grid size={12} />
                  Abrir Contact Sheet QA
                </button>
                <a
                  href={contactSheetSrc}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-xs"
                  style={{ textDecoration: "none" }}
                >
                  Nova Aba
                </a>
              </div>
            )}
          </div>
        )}

        {/* Distribution Pack */}
        {pack && (
          <div className="dist-pack-box">
            <div className="field-label" style={{ marginBottom: 2 }}>
              <span>Distribution Pack (Shorts / Reels / TikTok)</span>
            </div>

            <div className="dist-row">
              <div className="dist-text">
                <strong>Título Shorts ({pack.shorts_title.length} chars)</strong>
                {pack.shorts_title}
              </div>
              <button
                type="button"
                className="btn btn-xs"
                onClick={() => d.onCopyText("Título Shorts", pack.shorts_title)}
              >
                <Copy size={11} />
              </button>
            </div>

            <div className="dist-row">
              <div className="dist-text">
                <strong>Legenda Reels / TikTok</strong>
                {pack.caption_reels_tiktok}
              </div>
              <button
                type="button"
                className="btn btn-xs"
                onClick={() =>
                  d.onCopyText(
                    "Legenda + Hashtags",
                    `${pack.caption_reels_tiktok}\n\n${pack.hashtags.join(" ")}`
                  )
                }
              >
                <Copy size={11} />
              </button>
            </div>

            <div className="dist-row">
              <div className="dist-text">
                <strong>Hashtags</strong>
                <span className="mono">{pack.hashtags.join(" ")}</span>
              </div>
              <button
                type="button"
                className="btn btn-xs"
                onClick={() => d.onCopyText("Hashtags", pack.hashtags.join(" "))}
              >
                <Copy size={11} />
              </button>
            </div>

            <div className="dist-row">
              <div className="dist-text">
                <strong>Comentário Fixado</strong>
                {pack.pinned_comment}
              </div>
              <button
                type="button"
                className="btn btn-xs"
                onClick={() =>
                  d.onCopyText("Comentário Fixado", pack.pinned_comment)
                }
              >
                <Copy size={11} />
              </button>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                paddingTop: 4,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600 }}>
                  Capa PNG 1080×1920
                </span>
                <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>
                  {pack.cover_spec.headline}
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-blue"
                  disabled={d.busyCover}
                  onClick={() => void d.onGenerateCover()}
                >
                  <ImageIcon size={12} />
                  {d.busyCover ? "Gerando..." : "Gerar Capa PNG"}
                </button>
              </div>
              {coverSrc && d.artifacts.has_cover && (
                <a href={coverSrc} target="_blank" rel="noreferrer">
                  <img
                    src={coverSrc}
                    alt="Preview da Capa PNG"
                    className="cover-thumb"
                  />
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal leve de Contact Sheet */}
      {sheetOpen && contactSheetSrc && (
        <div
          className="modal-backdrop nodrag nowheel"
          onClick={() => setSheetOpen(false)}
        >
          <div
            className="modal-card contact-sheet-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-title">
                <Grid size={15} color="#E5A93C" />
                <span>Contact Sheet QA (Safe-Zones &amp; Cadência)</span>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => setSheetOpen(false)}
              >
                <X size={15} />
              </button>
            </div>
            <img
              src={contactSheetSrc}
              alt="Contact Sheet QA"
              className="contact-sheet-img"
            />
          </div>
        </div>
      )}
    </div>
  );
}
