// app/src/components/nodes/BriefingNode.tsx
import { useEffect, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { BookOpen, CheckCircle2, Sparkles, Wand2 } from "lucide-react";
import type {
  AudioMode,
  Briefing,
  FormatSeriesPreset,
  FormatType,
} from "../../types/studio";

export interface BriefingNodeData extends Record<string, unknown> {
  briefing: Briefing;
  formats: FormatSeriesPreset[];
  approved: boolean;
  busyRecommend: boolean;
  busySave: boolean;
  busyGenerate: boolean;
  onRecommend: (rawIdea: string, seedRef: string | null) => Promise<void>;
  onSave: (next: Briefing) => Promise<void>;
  onGenerateScript: () => Promise<void>;
}

const FALLBACK_FORMATS: FormatSeriesPreset[] = [
  {
    format_type: "mapa_contexto",
    label: "Mapa & Contexto",
    description: "Geografia, rotas, distâncias e arqueologia.",
    default_templates: ["timeline_map", "paper_collage", "bible_quote_card"],
    hook_types: ["mapa", "paradoxo"],
  },
  {
    format_type: "perdido_traducao",
    label: "Perdido na Tradução",
    description: "Termos originais em hebraico e grego.",
    default_templates: ["kinetic_captions", "bible_quote_card", "paper_collage"],
    hook_types: ["traducao", "paradoxo"],
  },
  {
    format_type: "mito_vs_texto",
    label: "Mito vs. Texto",
    description: "Desconstrução respeitosa de clichês bíblicos.",
    default_templates: ["paper_collage", "bible_quote_card", "kinetic_captions"],
    hook_types: ["mito", "paradoxo"],
  },
  {
    format_type: "conexao_at_nt",
    label: "Conexão AT → NT",
    description: "Paralelos e profecias entre AT e NT.",
    default_templates: ["timeline_map", "bible_quote_card", "paper_collage"],
    hook_types: ["paradoxo", "mapa"],
  },
];

export function BriefingNode({ data }: NodeProps) {
  const d = data as unknown as BriefingNodeData;
  const [draft, setDraft] = useState<Briefing>(d.briefing);

  useEffect(() => {
    setDraft(d.briefing);
  }, [d.briefing]);

  const formats = d.formats?.length ? d.formats : FALLBACK_FORMATS;
  const rec = draft.recommended_format;

  const handleSelectFormat = async (fmt: FormatType) => {
    const updated = { ...draft, selected_format_type: fmt };
    setDraft(updated);
    await d.onSave(updated);
  };

  const handleRecommend = async () => {
    await d.onRecommend(draft.raw_idea, draft.seed_reference);
  };

  const handleGenerate = async () => {
    await d.onSave(draft);
    await d.onGenerateScript();
  };

  return (
    <div
      className={`studio-node ${d.approved ? "node-status-ok" : "node-status-active"}`}
      style={{ width: 390 }}
      data-testid="node-briefing"
    >
      <div className="node-header">
        <div className="node-title-group">
          <span className="node-step-badge">01</span>
          <BookOpen size={14} color="#E5A93C" />
          <span className="node-title">Briefing &amp; Série</span>
        </div>
        {d.approved ? (
          <span className="pill pill-ok">
            <CheckCircle2 size={10} /> OK
          </span>
        ) : (
          <span className="pill pill-gold">ATIVO</span>
        )}
      </div>

      <div className="node-body nodrag nowheel">
        <div>
          <label className="field-label">Ideia Bruta / Tema</label>
          <textarea
            className="textarea"
            rows={2}
            value={draft.raw_idea}
            onChange={(e) => setDraft({ ...draft, raw_idea: e.target.value })}
            onBlur={() => {
              if (draft.raw_idea !== d.briefing.raw_idea) {
                void d.onSave(draft);
              }
            }}
          />
        </div>

        <div className="grid-2">
          <div>
            <label className="field-label">Referência Bíblica</label>
            <input
              className="input mono"
              placeholder="Ex.: Mt 5:3"
              value={draft.seed_reference || ""}
              onChange={(e) =>
                setDraft({ ...draft, seed_reference: e.target.value || null })
              }
              onBlur={() => {
                if (draft.seed_reference !== d.briefing.seed_reference) {
                  void d.onSave(draft);
                }
              }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button
              type="button"
              className="btn btn-blue"
              style={{ width: "100%" }}
              disabled={d.busyRecommend || !draft.raw_idea.trim()}
              onClick={handleRecommend}
            >
              <Sparkles size={13} />
              {d.busyRecommend ? "Analisando..." : "Recomendar Série"}
            </button>
          </div>
        </div>

        <div>
          <div className="field-label">
            <span>4 Formatos-Série Vox Bíblico</span>
            {rec && (
              <span className="mono" style={{ color: "#7eb2ff" }}>
                IA {Math.round(rec.confidence * 100)}%
              </span>
            )}
          </div>
          <div className="format-grid">
            {formats.map((fmt) => {
              const isSelected = draft.selected_format_type === fmt.format_type;
              const isRec = rec?.format_type === fmt.format_type;
              return (
                <button
                  key={fmt.format_type}
                  type="button"
                  className={`format-card ${isSelected ? "selected" : ""}`}
                  onClick={() => void handleSelectFormat(fmt.format_type)}
                >
                  <div className="format-card-top">
                    <span className="format-card-title">{fmt.label}</span>
                  </div>
                  {isRec && (
                    <span
                      className="pill pill-blue"
                      style={{ alignSelf: "flex-start", fontSize: 9.5 }}
                    >
                      Recomendado pela IA
                    </span>
                  )}
                  <span className="format-card-desc">{fmt.description}</span>
                </button>
              );
            })}
          </div>
        </div>

        {rec?.rationale && (
          <div className="rationale-box">
            <strong>Justificativa da IA:</strong> {rec.rationale}
          </div>
        )}

        <div className="grid-3">
          <div>
            <label className="field-label">Tradução</label>
            <select
              className="select mono"
              value={draft.bible_translation}
              onChange={(e) => {
                const updated = { ...draft, bible_translation: e.target.value };
                setDraft(updated);
                void d.onSave(updated);
              }}
            >
              <option value="NVI">NVI</option>
              <option value="ARA">ARA</option>
              <option value="NAA">NAA</option>
            </select>
          </div>

          <div>
            <label className="field-label">Alvo (s)</label>
            <input
              type="number"
              min={35}
              max={48}
              className="input mono"
              value={draft.target_duration_sec}
              onChange={(e) => {
                const val = Math.max(35, Math.min(48, Number(e.target.value) || 42));
                setDraft({ ...draft, target_duration_sec: val });
              }}
              onBlur={() => void d.onSave(draft)}
            />
          </div>

          <div>
            <label className="field-label">Áudio</label>
            <select
              className="select"
              value={draft.audio_mode}
              onChange={(e) => {
                const updated = {
                  ...draft,
                  audio_mode: e.target.value as AudioMode,
                };
                setDraft(updated);
                void d.onSave(updated);
              }}
            >
              <option value="recorded">Gravação ($0)</option>
              <option value="xtts_v2">XTTS-v2 ($0)</option>
              <option value="f5_tts">F5-TTS ($0)</option>
              <option value="voicestudio">VoiceStudio</option>
            </select>
          </div>
        </div>
      </div>

      <div className="node-footer nodrag nowheel">
        <span className="mono" style={{ fontSize: 10.5, color: "var(--text-muted)" }}>
          35–48s · {draft.bible_translation}
        </span>
        <button
          type="button"
          className="btn btn-primary"
          disabled={d.busyGenerate || d.busySave}
          onClick={() => void handleGenerate()}
        >
          <Wand2 size={13} />
          {d.busyGenerate ? "Gerando..." : "Gerar Roteiro & 3 Hooks"}
        </button>
      </div>

      <Handle type="source" position={Position.Right} id="briefing-out" />
    </div>
  );
}
