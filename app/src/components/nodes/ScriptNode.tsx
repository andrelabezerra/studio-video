// app/src/components/nodes/ScriptNode.tsx
import { useEffect, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { ScriptData } from "../../types/studio";

export interface ScriptNodeData extends Record<string, unknown> {
  script: ScriptData | null;
  gate1Approved: boolean;
  busyRefine: boolean;
  busySave: boolean;
  busyApprove: boolean;
  onSaveScript: (next: ScriptData, silent?: boolean) => Promise<void>;
  onRefineScript: (
    instruction: string,
    target: "hooks" | "segments" | "distribution"
  ) => Promise<void>;
  onApproveGate1: () => Promise<void>;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function ScriptNode({ data }: NodeProps) {
  const d = data as unknown as ScriptNodeData;
  const [draft, setDraft] = useState<ScriptData | null>(d.script);
  const [refineInput, setRefineInput] = useState("");
  const [refineTarget, setRefineTarget] = useState<
    "hooks" | "segments" | "distribution"
  >("hooks");

  useEffect(() => {
    setDraft(d.script);
  }, [d.script]);

  const refs = draft?.scripture_refs || [];
  const allRefsVerified =
    refs.length > 0 && refs.every((r) => Boolean(r.verified_by_human));
  const missingRefsCount = refs.filter((r) => !r.verified_by_human).length;

  const handleSelectHook = async (hookId: string) => {
    if (!draft) return;
    const chosen = draft.hooks.find((h) => h.id === hookId);
    const updatedSegments = draft.narration_segments.map((seg, idx) =>
      idx === 0 && chosen
        ? { ...seg, display_text: chosen.spoken_text, tts_text: chosen.spoken_text }
        : seg
    );
    const next: ScriptData = {
      ...draft,
      selected_hook_id: hookId,
      narration_segments: updatedSegments,
    };
    setDraft(next);
    await d.onSaveScript(next, true);
  };

  const handleSegmentChange = (segId: string, text: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      narration_segments: draft.narration_segments.map((seg) =>
        seg.segment_id === segId
          ? { ...seg, display_text: text, tts_text: text }
          : seg
      ),
    });
  };

  const handleToggleScripture = async (refId: string, checked: boolean) => {
    if (!draft) return;
    const next: ScriptData = {
      ...draft,
      scripture_refs: draft.scripture_refs.map((r) =>
        r.ref_id === refId ? { ...r, verified_by_human: checked } : r
      ),
    };
    setDraft(next);
    await d.onSaveScript(next, true);
  };

  const handleRefine = async () => {
    if (!refineInput.trim()) return;
    await d.onRefineScript(refineInput.trim(), refineTarget);
    setRefineInput("");
  };

  const handleApprove = async () => {
    if (!draft || !allRefsVerified) return;
    await d.onSaveScript(draft, true);
    await d.onApproveGate1();
  };

  const statusClass = d.gate1Approved
    ? "node-status-ok"
    : draft
      ? allRefsVerified
        ? "node-status-active"
        : "node-status-alert"
      : "";

  return (
    <div
      className={`studio-node ${statusClass}`}
      style={{ width: 455 }}
      data-testid="node-script"
    >
      <Handle type="target" position={Position.Left} id="script-in" />

      <div className="node-header">
        <div className="node-title-group">
          <span className="node-step-badge">02</span>
          <FileText size={14} color="#E5A93C" />
          <span className="node-title">Roteiro &amp; 3 Hooks (0–3s)</span>
        </div>
        {d.gate1Approved ? (
          <span className="pill pill-ok">
            <CheckCircle2 size={10} /> GATE 1 OK
          </span>
        ) : draft ? (
          <span className="pill pill-gold">EM REVISÃO</span>
        ) : (
          <span className="pill">AGUARDANDO</span>
        )}
      </div>

      <div className="node-body nodrag nowheel">
        {!draft ? (
          <div
            style={{
              padding: "24px 12px",
              textAlign: "center",
              color: "var(--text-secondary)",
            }}
          >
            Clique em <strong>“Gerar Roteiro &amp; 3 Hooks”</strong> no nó de
            Briefing para iniciar a co-criação.
          </div>
        ) : (
          <>
            {/* 3 Hooks */}
            <div>
              <div className="field-label">
                <span>Escolha 1 dos 3 Hooks (máx. 8 palavras)</span>
                <span className="mono">{draft.hooks.length} opções</span>
              </div>
              <div className="hook-list">
                {draft.hooks.map((hook) => {
                  const wc = countWords(hook.spoken_text);
                  const overLimit = wc > 8;
                  const selected = draft.selected_hook_id === hook.id;
                  return (
                    <button
                      key={hook.id}
                      type="button"
                      className={`hook-card ${selected ? "selected" : ""}`}
                      onClick={() => void handleSelectHook(hook.id)}
                    >
                      <div className="hook-card-meta">
                        <span className="pill pill-gold">{hook.hook_type}</span>
                        <span
                          className={`pill ${overLimit ? "pill-alert" : "pill-ok"}`}
                        >
                          {overLimit && <AlertTriangle size={10} />}
                          {wc} palavras
                        </span>
                      </div>
                      <span className="hook-spoken">“{hook.spoken_text}”</span>
                      <span className="hook-visual">
                        Pattern interrupt: {hook.visual_interrupt}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Segmentos Prosódicos */}
            <div>
              <div className="field-label">
                <span>Segmentos Prosódicos ({draft.narration_segments.length})</span>
                <button
                  type="button"
                  className="btn btn-xs"
                  disabled={d.busySave}
                  onClick={() => void d.onSaveScript(draft)}
                >
                  Salvar Edições
                </button>
              </div>
              <div className="scroll-box">
                {draft.narration_segments.map((seg) => (
                  <div key={seg.segment_id} className="segment-row">
                    <div className="segment-head">
                      <span>
                        {seg.segment_id.toUpperCase()} · {seg.role}
                      </span>
                      <span>{countWords(seg.display_text)} pal.</span>
                    </div>
                    <input
                      className="input"
                      style={{ padding: "5px 8px", fontSize: 12 }}
                      value={seg.display_text}
                      onChange={(e) =>
                        handleSegmentChange(seg.segment_id, e.target.value)
                      }
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Caixa de Refino Pontual estilo Neo Stitch */}
            <div className="refine-box">
              <div className="field-label" style={{ marginBottom: 0 }}>
                <span>Refino Pontual (Contexto Isolado)</span>
                <span className="mono" style={{ color: "var(--vox-gold)" }}>
                  1 nó apenas
                </span>
              </div>
              <div className="refine-row">
                <select
                  className="select"
                  style={{ width: 125 }}
                  aria-label="Alvo do refino"
                  value={refineTarget}
                  onChange={(e) =>
                    setRefineTarget(
                      e.target.value as "hooks" | "segments" | "distribution"
                    )
                  }
                >
                  <option value="hooks">Hooks</option>
                  <option value="segments">Segmentos</option>
                  <option value="distribution">Empacotamento</option>
                </select>
                <input
                  className="input"
                  placeholder="Ex.: Deixe mais direto e curioso..."
                  value={refineInput}
                  onChange={(e) => setRefineInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleRefine();
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-blue"
                  disabled={d.busyRefine || !refineInput.trim()}
                  onClick={() => void handleRefine()}
                >
                  <Sparkles size={12} />
                  {d.busyRefine ? "..." : "Refinar Nó"}
                </button>
              </div>
            </div>

            {/* Checkpoint de Rigor Bíblico */}
            <div
              className={`scripture-box ${!allRefsVerified ? "unverified" : ""}`}
              data-testid="bible-checkpoint"
            >
              <div className="field-label" style={{ marginBottom: 0 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <ShieldCheck
                    size={13}
                    color={allRefsVerified ? "#34D399" : "#E05A47"}
                  />
                  Checkpoint de Rigor Bíblico
                </span>
                <span
                  className={`pill ${allRefsVerified ? "pill-ok" : "pill-alert"}`}
                >
                  {allRefsVerified
                    ? "Conferido"
                    : `${missingRefsCount || 1} pendente(s)`}
                </span>
              </div>

              {refs.length === 0 ? (
                <div style={{ fontSize: 11.5, color: "#ff8c7d" }}>
                  Nenhuma referência bíblica listada. Adicione ou gere novamente.
                </div>
              ) : (
                refs.map((ref) => (
                  <div key={ref.ref_id} className="scripture-item">
                    <label className="scripture-check">
                      <input
                        type="checkbox"
                        checked={Boolean(ref.verified_by_human)}
                        onChange={(e) =>
                          void handleToggleScripture(ref.ref_id, e.target.checked)
                        }
                      />
                      <span>
                        Texto conferido · {ref.citation} ({ref.translation})
                      </span>
                    </label>
                    <div className="scripture-quote">“{ref.exact_text}”</div>
                  </div>
                ))
              )}

              {!allRefsVerified && (
                <div
                  style={{
                    fontSize: 11,
                    color: "#ff8c7d",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <AlertTriangle size={12} />
                  Gate 1 bloqueado: marque “Texto conferido” em todos os versículos.
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="node-footer nodrag nowheel">
        <span className="mono" style={{ fontSize: 10.5, color: "var(--text-muted)" }}>
          Gate 1 · Rigor Bíblico
        </span>
        <button
          type="button"
          className={`btn ${allRefsVerified ? "btn-primary" : ""}`}
          disabled={!draft || !allRefsVerified || d.busyApprove}
          onClick={() => void handleApprove()}
          title={
            !allRefsVerified
              ? "Marque todos os versículos como conferidos antes de aprovar o Gate 1"
              : "Aprovar roteiro e gerar cenas 9:16"
          }
        >
          <ShieldCheck size={13} />
          {d.busyApprove ? "Gerando Cenas..." : "Aprovar Gate 1 → Gerar Cenas"}
        </button>
      </div>

      <Handle type="source" position={Position.Right} id="script-out" />
    </div>
  );
}
