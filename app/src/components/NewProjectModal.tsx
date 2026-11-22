// app/src/components/NewProjectModal.tsx
import { useEffect, useState } from "react";
import { CopyPlus, Sparkles, X } from "lucide-react";
import type {
  BibleTranslation,
  CloneWorkflowPayload,
  ProjectDetail,
} from "../types/studio";

export type NewProjectModalMode = "scratch" | "clone";

interface NewProjectModalProps {
  open: boolean;
  initialMode?: NewProjectModalMode;
  sourceProject?: ProjectDetail | null;
  busy: boolean;
  onClose: () => void;
  onSubmitCreate: (payload: {
    title: string;
    raw_idea: string;
    seed_reference?: string;
    bible_translation?: string;
  }) => Promise<void>;
  onSubmitClone?: (
    sourceSlug: string,
    payload: CloneWorkflowPayload
  ) => Promise<void>;
}

const VALID_TRANSLATIONS: BibleTranslation[] = ["NVI", "ARA", "NAA", "KJA"];

function toBibleTranslation(value: string | undefined): BibleTranslation {
  if (value && VALID_TRANSLATIONS.includes(value as BibleTranslation)) {
    return value as BibleTranslation;
  }
  return "NVI";
}

export function NewProjectModal({
  open,
  initialMode = "scratch",
  sourceProject = null,
  busy,
  onClose,
  onSubmitCreate,
  onSubmitClone,
}: NewProjectModalProps) {
  const [mode, setMode] = useState<NewProjectModalMode>(initialMode);
  const [title, setTitle] = useState("");
  const [rawIdea, setRawIdea] = useState("");
  const [seedReference, setSeedReference] = useState("");
  const [translation, setTranslation] = useState<BibleTranslation>("NVI");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const effectiveMode: NewProjectModalMode =
      initialMode === "clone" && sourceProject ? "clone" : "scratch";
    setMode(effectiveMode);
    setError(null);
    if (effectiveMode === "clone" && sourceProject) {
      setTranslation(toBibleTranslation(sourceProject.briefing.bible_translation));
    } else {
      setTranslation("NVI");
    }
  }, [open, initialMode, sourceProject]);

  if (!open) return null;

  const isClone = mode === "clone" && Boolean(sourceProject && onSubmitClone);
  const inheritedFormatObj = sourceProject?.preset.formats_series.find(
    (f) => f.format_type === sourceProject.briefing.selected_format_type
  );
  const inheritedFormatLabel =
    inheritedFormatObj?.label ||
    sourceProject?.briefing.selected_format_type ||
    "—";
  const nextEpisodeNum = (sourceProject?.manifest.series.episode_number ?? 1) + 1;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanTitle = title.trim();
    const cleanIdea = rawIdea.trim() || cleanTitle;
    if (!cleanTitle) {
      setError("Informe um título ou tema central para o vídeo.");
      return;
    }
    try {
      if (isClone && sourceProject && onSubmitClone) {
        await onSubmitClone(sourceProject.manifest.slug, {
          title: cleanTitle,
          raw_idea: cleanIdea,
          seed_reference: seedReference.trim() || null,
          bible_translation: translation,
        });
      } else {
        await onSubmitCreate({
          title: cleanTitle,
          raw_idea: cleanIdea,
          seed_reference: seedReference.trim() || undefined,
          bible_translation: translation,
        });
      }
      setTitle("");
      setRawIdea("");
      setSeedReference("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar projeto.");
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        data-testid="new-project-modal"
        style={{ width: "min(540px, 94vw)" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={
          isClone
            ? "Novo Episódio deste Estilo"
            : "Criar novo vídeo Vox Bíblico"
        }
      >
        <div className="modal-header">
          <div className="modal-title">
            {isClone ? (
              <CopyPlus size={16} color="#E5A93C" />
            ) : (
              <Sparkles size={16} color="#E5A93C" />
            )}
            <span>
              {isClone
                ? "Novo Episódio deste Estilo (1 Vídeo)"
                : "Novo Vídeo · Co-criação Guiada"}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={onClose}
            aria-label="Fechar modal"
          >
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="node-body" style={{ padding: 18 }}>
          {sourceProject && onSubmitClone && (
            <div className="modal-mode-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "scratch"}
                data-testid="tab-mode-scratch"
                className={`modal-mode-tab ${mode === "scratch" ? "active" : ""}`}
                onClick={() => setMode("scratch")}
              >
                <Sparkles size={13} />
                Novo do Zero
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "clone"}
                data-testid="tab-mode-clone"
                className={`modal-mode-tab ${mode === "clone" ? "active" : ""}`}
                onClick={() => {
                  setMode("clone");
                  setTranslation(
                    toBibleTranslation(sourceProject.briefing.bible_translation)
                  );
                }}
              >
                <CopyPlus size={13} />
                <span className="truncate">
                  Herdar de &ldquo;{sourceProject.manifest.title}&rdquo;
                </span>
              </button>
            </div>
          )}

          {isClone && sourceProject && (
            <div className="clone-inherit-summary" data-testid="clone-inherit-summary">
              <div className="clone-inherit-header">
                <span>Workflow Herdado (1 episódio · gates zerados)</span>
                <span className="pill pill-gold">Ep. #{nextEpisodeNum}</span>
              </div>
              <div className="clone-inherit-grid">
                <div>
                  <span className="clone-meta-k">Série</span>
                  <span className="clone-meta-v">{inheritedFormatLabel}</span>
                </div>
                <div>
                  <span className="clone-meta-k">Tradução</span>
                  <span className="clone-meta-v mono">
                    {sourceProject.briefing.bible_translation}
                  </span>
                </div>
                <div>
                  <span className="clone-meta-k">Duração Alvo</span>
                  <span className="clone-meta-v mono">
                    {sourceProject.briefing.target_duration_sec}s
                  </span>
                </div>
                <div>
                  <span className="clone-meta-k">Áudio</span>
                  <span className="clone-meta-v mono">
                    {sourceProject.briefing.audio_mode}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="field-label" htmlFor="new-proj-title">
              Título / Tema do Episódio *
            </label>
            <input
              id="new-proj-title"
              className="input"
              placeholder={
                isClone
                  ? "Ex.: O que significa 'Metanoia' no original grego"
                  : "Ex.: A parábola do filho pródigo em Lucas 15"
              }
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>

          <div>
            <label className="field-label" htmlFor="new-proj-idea">
              Ideia Bruta / Gancho Pastoral ou Roteiro Pronto
            </label>
            <textarea
              id="new-proj-idea"
              className="textarea"
              rows={5}
              placeholder="Descreva sua ideia/gancho ou cole aqui um roteiro já pronto (várias frases ou parágrafos) para a IA ajustar e segmentar..."
              value={rawIdea}
              onChange={(e) => setRawIdea(e.target.value)}
            />
            {rawIdea.trim() && (
              <div
                className="mono"
                style={{
                  fontSize: 10.5,
                  color: "var(--text-muted)",
                  marginTop: 4,
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>
                  {rawIdea.trim().split(/\s+/).length} palavras · {rawIdea.length}/15000 chars
                </span>
                <span>
                  {rawIdea.trim().split(/[.!?\n]+/).filter((s) => s.trim()).length >= 3
                    ? "Roteiro pronto detectado (IA ajustará mantendo seu texto)"
                    : "Ideia / Gancho inicial"}
                </span>
              </div>
            )}
          </div>

          <div className="grid-2">
            <div>
              <label className="field-label" htmlFor="new-proj-ref">
                Referência Bíblica (opcional)
              </label>
              <input
                id="new-proj-ref"
                className="input mono"
                placeholder="Ex.: Lc 15:11-24"
                value={seedReference}
                onChange={(e) => setSeedReference(e.target.value)}
              />
            </div>

            <div>
              <label className="field-label" htmlFor="new-proj-tr">
                Tradução Bíblica
              </label>
              <select
                id="new-proj-tr"
                className="select"
                value={translation}
                onChange={(e) => setTranslation(e.target.value as BibleTranslation)}
              >
                <option value="NVI">NVI (Nova Versão Internacional)</option>
                <option value="ARA">ARA (Almeida Revista e Atualizada)</option>
                <option value="NAA">NAA (Nova Almeida Atualizada)</option>
                <option value="KJA">KJA (King James Atualizada)</option>
              </select>
            </div>
          </div>

          {error && (
            <div className="pill pill-alert" style={{ padding: "6px 10px", borderRadius: 6 }}>
              {error}
            </div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              marginTop: 6,
            }}
          >
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              data-testid="btn-submit-new-project"
              disabled={busy}
            >
              {isClone ? <CopyPlus size={13} /> : <Sparkles size={13} />}
              {busy
                ? isClone
                  ? "Clonando Estilo..."
                  : "Criando & Classificando..."
                : isClone
                  ? "Criar Episódio deste Estilo"
                  : "Criar & Recomendar Série"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
