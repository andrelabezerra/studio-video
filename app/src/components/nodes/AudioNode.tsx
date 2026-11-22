// app/src/components/nodes/AudioNode.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  AlertTriangle,
  AudioWaveform,
  BookOpenText,
  CheckCircle2,
  Copy,
  Cpu,
  Mic,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type {
  AudioAlignment,
  AudioCapabilities,
  GenerateTtsPayload,
  TtsEngineId,
  TtsEngineInfo,
  TtsPreviewResponse,
  VoiceSampleInfo,
} from "../../types/studio";
import type { RenderProgressState } from "../../hooks/useStudioProject";

const FALLBACK_TTS_ENGINES: TtsEngineInfo[] = [
  {
    id: "pilot_sapi",
    label: "Piloto Local PT-BR ($0 · instantâneo)",
    ready: true,
    requires_sample: false,
    mode: "local_fast",
    hint: "Voz sintética nativa do Windows (não clona amostra).",
  },
  {
    id: "xtts_v2",
    label: "XTTS-v2 Zero-Shot ($0 · clonagem)",
    ready: true,
    requires_sample: true,
    mode: "isolated_venv",
    hint: "Clona a voz da amostra em PT-BR no venv isolado.",
  },
  {
    id: "f5_tts",
    label: "F5-TTS PT-BR ($0 · clonagem)",
    ready: true,
    requires_sample: true,
    mode: "isolated_venv",
    hint: "Clonagem neural F5-TTS pronta no venv isolado.",
  },
  {
    id: "voicestudio",
    label: "VoiceStudio Local HTTP ($0)",
    ready: false,
    requires_sample: true,
    mode: "local_http",
    hint: "Servidor local VoiceStudio HTTP.",
  },
];

export interface AudioNodeData extends Record<string, unknown> {
  alignment: AudioAlignment | null;
  hasAudio: boolean;
  audioUrl: string | null;
  mediaRevision: number;
  alignedGate: boolean;
  isStale?: boolean;
  canAlign: boolean;
  busyUpload: boolean;
  busyAlign: boolean;
  busySampleUpload: boolean;
  busySampleDelete: boolean;
  busyPreviewTts: boolean;
  busyGenerateTts: boolean;
  audioCapabilities: AudioCapabilities | null;
  ttsPreview: TtsPreviewResponse | null;
  renderProgress: RenderProgressState;
  onUploadAudio: (file: File) => Promise<void>;
  onAlignAudio: (source?: "recorded" | "pilot") => Promise<void>;
  onUploadVoiceSample: (file: File, name?: string) => Promise<VoiceSampleInfo | null>;
  onDeleteVoiceSample: (sampleId: string) => Promise<boolean>;
  onPreviewTts: () => Promise<TtsPreviewResponse | null>;
  onGenerateTts: (payload: GenerateTtsPayload) => Promise<unknown>;
  onCopyText: (label: string, text: string) => void;
}

type AudioTab = "recorded" | "tts";

export function AudioNode({ data }: NodeProps) {
  const d = data as unknown as AudioNodeData;
  const recordedInputRef = useRef<HTMLInputElement | null>(null);
  const sampleInputRef = useRef<HTMLInputElement | null>(null);

  const [activeTab, setActiveTab] = useState<AudioTab>("recorded");
  const [dragging, setDragging] = useState(false);
  const [selectedEngineId, setSelectedEngineId] = useState<TtsEngineId>("pilot_sapi");
  const [userPickedEngine, setUserPickedEngine] = useState<boolean>(false);
  const [selectedSampleId, setSelectedSampleId] = useState<string>("");
  const [previewOpen, setPreviewOpen] = useState<boolean>(false);

  const capabilities = d.audioCapabilities;
  const engines =
    capabilities?.engines && capabilities.engines.length > 0
      ? capabilities.engines
      : FALLBACK_TTS_ENGINES;
  const voiceSamples = capabilities?.voice_samples ?? [];

  // Mantém seleção de amostra sincronizada e auto-seleciona motor de clonagem se houver amostra
  useEffect(() => {
    if (voiceSamples.length === 0) {
      if (selectedSampleId !== "") setSelectedSampleId("");
      return;
    }
    const stillExists = voiceSamples.some((s) => s.id === selectedSampleId);
    if (!stillExists) {
      const preferred = voiceSamples.find((s) => s.is_default) ?? voiceSamples[0];
      setSelectedSampleId(preferred.id);
    }
    if (!userPickedEngine && selectedEngineId === "pilot_sapi") {
      const readyClone =
        engines.find((e) => e.id === "xtts_v2" && e.ready) ??
        engines.find((e) => e.requires_sample && e.ready);
      if (readyClone) {
        setSelectedEngineId(readyClone.id);
      }
    }
  }, [voiceSamples, selectedSampleId, engines, userPickedEngine, selectedEngineId]);

  const selectedEngine = useMemo(
    () => engines.find((e) => e.id === selectedEngineId) ?? engines[0] ?? null,
    [engines, selectedEngineId]
  );

  const selectedSample = useMemo(
    () => voiceSamples.find((s) => s.id === selectedSampleId) ?? null,
    [voiceSamples, selectedSampleId]
  );

  const sampleDurationOutOfRange = Boolean(
    selectedSample &&
      (selectedSample.duration_sec < 6 || selectedSample.duration_sec > 15)
  );
  const sampleWarningText =
    selectedSample?.warning ||
    (sampleDurationOutOfRange
      ? "Recomendado: amostra limpa entre 6s e 15s para clonagem fiel."
      : null);

  const wordCount = d.alignment?.words.length ?? 0;
  const durationSec = d.alignment ? (d.alignment.duration_ms / 1000).toFixed(1) : null;
  const audioSrc = d.audioUrl ? `${d.audioUrl}?v=${d.mediaRevision}` : null;

  const isTtsStage =
    d.renderProgress.stage === "tts_generate" ||
    d.renderProgress.stage === "audio_align";
  const showTtsProgress = Boolean(
    isTtsStage &&
      (d.renderProgress.active ||
        Boolean(d.renderProgress.error) ||
        d.renderProgress.progressPct > 0)
  );

  const missingRequiredSample = Boolean(
    selectedEngine?.requires_sample && !selectedSampleId && voiceSamples.length === 0
  );
  const engineCanRunOrAutoSetup = Boolean(
    selectedEngine &&
      (selectedEngine.ready ||
        selectedEngine.id === "xtts_v2" ||
        selectedEngine.id === "f5_tts")
  );
  const canGenerateTts = Boolean(
    d.canAlign &&
      engineCanRunOrAutoSetup &&
      !missingRequiredSample &&
      !d.busyGenerateTts &&
      !(d.renderProgress.active && isTtsStage)
  );

  const handleRecordedFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    await d.onUploadAudio(file);
  };

  const handleSampleFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const uploaded = await d.onUploadVoiceSample(file);
    if (uploaded) {
      setSelectedSampleId(uploaded.id);
      if (selectedEngineId === "pilot_sapi") {
        const cloneEngine =
          engines.find((e) => e.id === "xtts_v2" && e.ready) ??
          engines.find((e) => e.requires_sample && e.ready) ??
          engines.find((e) => e.id === "xtts_v2");
        if (cloneEngine) {
          setSelectedEngineId(cloneEngine.id);
        }
      }
    }
  };

  const handlePreviewClick = async () => {
    const res = await d.onPreviewTts();
    if (res) {
      setPreviewOpen(true);
    }
  };

  const handleGenerateTtsClick = async () => {
    if (!selectedEngine) return;
    const effectiveSampleId =
      selectedSampleId || (voiceSamples[0]?.id ?? null);
    await d.onGenerateTts({
      engine: selectedEngine.id,
      voice_sample_id: effectiveSampleId,
      auto_align: true,
      auto_setup: true,
    });
  };

  return (
    <div
      className={`studio-node ${
        d.isStale
          ? "node-status-stale"
          : d.alignedGate
            ? "node-status-ok"
            : d.canAlign
              ? "node-status-active"
              : ""
      }`}
      style={{ width: 340 }}
      data-testid="node-audio"
    >
      <Handle type="target" position={Position.Left} id="audio-in" />

      <div className="node-header">
        <div className="node-title-group">
          <span className="node-step-badge">03</span>
          <Mic size={14} color="#E5A93C" />
          <span className="node-title">Áudio &amp; Metrônomo</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {d.isStale && <span className="pill pill-stale">desatualizado</span>}
          {d.alignedGate ? (
            <span className="pill pill-ok">
              <CheckCircle2 size={10} /> SINCRONIZADO
            </span>
          ) : (
            <span className="pill">$0 LOCAL</span>
          )}
        </div>
      </div>

      <div className="node-body nodrag nowheel">
        {/* Abas compactas no topo do corpo */}
        <div className="audio-mode-tabs" role="tablist" aria-label="Origem da narração">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "recorded"}
            className={`audio-mode-tab ${activeTab === "recorded" ? "active" : ""}`}
            data-testid="audio-tab-recorded"
            onClick={() => setActiveTab("recorded")}
          >
            <Mic size={12} />
            <span>Gravação</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "tts"}
            className={`audio-mode-tab ${activeTab === "tts" ? "active" : ""}`}
            data-testid="audio-tab-tts"
            onClick={() => setActiveTab("tts")}
          >
            <Sparkles size={12} />
            <span>Clonar Voz ($0)</span>
          </button>
        </div>

        {/* ABA 1: GRAVAÇÃO REAL */}
        {activeTab === "recorded" ? (
          <div className="audio-tab-panel">
            <div
              className={`dropzone ${dragging ? "dragging" : ""}`}
              onClick={() => recordedInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void handleRecordedFiles(e.dataTransfer.files);
              }}
            >
              <input
                ref={recordedInputRef}
                type="file"
                accept=".wav,.mp3,.m4a,audio/*"
                hidden
                onChange={(e) => {
                  void handleRecordedFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  fontWeight: 600,
                  marginBottom: 3,
                }}
              >
                <Upload size={13} color="#E5A93C" />
                {d.busyUpload
                  ? "Enviando & Normalizando..."
                  : "Enviar Gravação (.wav / .mp3)"}
              </div>
              <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>
                Salvo no cache local (48kHz mono · fora do OneDrive)
              </div>
            </div>

            {!d.hasAudio && (
              <div className="tts-hint-box">
                Sem gravação anexada. Envie um <code>.wav/.mp3</code> do Pastor
                André ou use a aba <strong>Clonar Voz ($0)</strong>.
              </div>
            )}
          </div>
        ) : (
          /* ABA 2: CLONAR VOZ ($0) */
          <div className="audio-tab-panel">
            {/* Pílula discreta de hardware + aviso enxuto */}
            <div className="tts-hw-row">
              <span className="field-label" style={{ marginBottom: 0 }}>
                Motor TTS Local
              </span>
              <span
                className={`pill ${
                  capabilities?.hardware === "cuda" ? "pill-ok" : "pill-gold"
                }`}
                data-testid="tts-hardware-badge"
                title={
                  capabilities?.cpu_warning ||
                  capabilities?.gpu_name ||
                  "Hardware detectado"
                }
              >
                <Cpu size={10} />
                {capabilities
                  ? capabilities.hardware === "cuda"
                    ? `GPU${capabilities.gpu_name ? ` · ${capabilities.gpu_name}` : ""}`
                    : "CPU"
                  : "..."}
              </span>
            </div>

            {capabilities?.cpu_warning && (
              <div className="tts-hw-warning" title={capabilities.cpu_warning}>
                <AlertTriangle size={11} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{capabilities.cpu_warning}</span>
              </div>
            )}

            {/* Seletor compacto das 4 engines */}
            {engines.length > 0 ? (
              <div className="tts-engine-list" role="radiogroup" aria-label="Engine TTS">
                {engines.map((eng) => {
                  const isSelected = selectedEngine?.id === eng.id;
                  return (
                    <button
                      key={eng.id}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      className={`tts-engine-item ${isSelected ? "selected" : ""}`}
                      data-testid={`tts-engine-${eng.id}`}
                      data-engine-id={eng.id}
                      title={eng.hint}
                      onClick={() => {
                        setUserPickedEngine(true);
                        setSelectedEngineId(eng.id);
                      }}
                    >
                      <div className="tts-engine-main">
                        <span
                          className={`tts-radio-dot ${isSelected ? "checked" : ""}`}
                        />
                        <div className="tts-engine-text">
                          <span className="tts-engine-label">{eng.label}</span>
                          <span className="mono tts-engine-id">{eng.id}</span>
                        </div>
                      </div>
                      <span
                        className={`pill ${eng.ready ? "pill-ok" : "pill-gold"}`}
                      >
                        {eng.ready ? "Pronto" : "Requer setup"}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="tts-hint-box">
                Consultando engines TTS em <code>/api/audio/capabilities</code>...
              </div>
            )}

            {/* Aviso de setup + copiar comando quando engine não está pronta */}
            {selectedEngine && !selectedEngine.ready && (
              <div className="tts-setup-box">
                <div className="tts-setup-hint">{selectedEngine.hint}</div>
                {capabilities?.setup_command && (
                  <button
                    type="button"
                    className="btn btn-xs"
                    data-testid="btn-copy-setup-cmd"
                    onClick={() =>
                      d.onCopyText("Comando Setup TTS", capabilities.setup_command)
                    }
                    title={capabilities.setup_command}
                  >
                    <Copy size={11} />
                    Copiar setup_tts_venv
                  </button>
                )}
              </div>
            )}

            {/* Gestor compacto de Amostra de Voz */}
            <div className="tts-sample-box">
              <div className="field-label" style={{ marginBottom: 4 }}>
                <span>Amostra de Voz (Pastor André)</span>
                {selectedSample && (
                  <span
                    className={`mono ${
                      sampleWarningText ? "tts-dur-warn" : "tts-dur-ok"
                    }`}
                    data-testid="voice-sample-duration"
                  >
                    {selectedSample.duration_sec.toFixed(1)}s
                  </span>
                )}
              </div>

              <div className="tts-sample-controls">
                <select
                  className="select tts-sample-select"
                  data-testid="select-voice-sample"
                  aria-label="Selecionar amostra de voz"
                  value={selectedSampleId}
                  onChange={(e) => setSelectedSampleId(e.target.value)}
                  disabled={voiceSamples.length === 0}
                >
                  {voiceSamples.length === 0 ? (
                    <option value="">Nenhuma amostra cadastrada</option>
                  ) : (
                    voiceSamples.map((sample) => (
                      <option key={sample.id} value={sample.id}>
                        {sample.filename} ({sample.duration_sec.toFixed(1)}s)
                      </option>
                    ))
                  )}
                </select>
                <button
                  type="button"
                  className="btn btn-xs btn-danger"
                  data-testid="btn-delete-voice-sample"
                  title="Excluir amostra selecionada"
                  disabled={!selectedSampleId || d.busySampleDelete}
                  onClick={() => {
                    if (selectedSampleId) {
                      void d.onDeleteVoiceSample(selectedSampleId);
                    }
                  }}
                >
                  <Trash2 size={11} />
                </button>
              </div>

              <input
                ref={sampleInputRef}
                type="file"
                accept=".wav,.mp3,.m4a,.ogg,.flac,audio/*"
                hidden
                data-testid="input-voice-sample"
                onChange={(e) => {
                  void handleSampleFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                className="btn btn-xs tts-upload-sample-btn"
                data-testid="btn-upload-voice-sample"
                disabled={d.busySampleUpload}
                onClick={() => sampleInputRef.current?.click()}
              >
                <Upload size={11} color="#E5A93C" />
                {d.busySampleUpload
                  ? "Processando amostra 24kHz..."
                  : "Enviar Amostra (.wav/.mp3)"}
              </button>

              {sampleWarningText && (
                <div className="tts-sample-warning" data-testid="voice-sample-warning">
                  <AlertTriangle size={11} style={{ flexShrink: 0 }} />
                  <span>{sampleWarningText}</span>
                </div>
              )}

              {selectedEngine?.id === "pilot_sapi" && voiceSamples.length > 0 && (
                <div className="tts-sample-warning" data-testid="pilot-sapi-sample-notice">
                  <AlertTriangle size={11} style={{ flexShrink: 0 }} />
                  <span>
                    <strong>pilot_sapi</strong> usa a voz nativa do Windows (sem
                    clonar a amostra). Para clonar <code>{selectedSample?.filename || "a amostra"}</code>,
                    configure e selecione <strong>XTTS-v2</strong> ou{" "}
                    <strong>F5-TTS</strong>.
                  </span>
                </div>
              )}
            </div>

            {/* Ações Pré-TTS e Síntese */}
            <div className="tts-actions-col">
              <button
                type="button"
                className="btn btn-sm"
                data-testid="btn-preview-tts"
                disabled={!d.canAlign || d.busyPreviewTts}
                onClick={() => void handlePreviewClick()}
              >
                <BookOpenText size={12} />
                {d.busyPreviewTts ? "Normalizando..." : "Ver Texto Normalizado"}
              </button>

              {previewOpen && d.ttsPreview && (
                <div className="tts-preview-panel">
                  <div className="tts-preview-header">
                    <span className="mono">
                      {d.ttsPreview.total_chunks} chunks · {d.ttsPreview.total_chars}{" "}
                      chars · ~{d.ttsPreview.estimated_duration_sec.toFixed(1)}s
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      style={{ height: 18, padding: "0 4px" }}
                      title="Recolher preview"
                      onClick={() => setPreviewOpen(false)}
                    >
                      <X size={11} />
                    </button>
                  </div>
                  <div
                    className="tts-preview-list nowheel nodrag"
                    data-testid="tts-preview-list"
                  >
                    {d.ttsPreview.chunks.map((chunk, idx) => (
                      <div
                        key={`${chunk.segment_id}-${idx}`}
                        className="tts-preview-item"
                      >
                        <div className="tts-preview-item-head">
                          <span className="mono">{chunk.segment_id}</span>
                          <span className="mono">{chunk.char_count}c</span>
                        </div>
                        <div className="tts-preview-item-text">
                          {chunk.normalized_text}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                type="button"
                className="btn btn-primary btn-sm"
                data-testid="btn-generate-tts"
                disabled={!canGenerateTts}
                title={
                  !d.canAlign
                    ? "Gere o roteiro antes de sintetizar áudio."
                    : !selectedEngine?.ready
                      ? selectedEngine?.hint || "Engine selecionada requer setup."
                      : missingRequiredSample
                        ? "Envie ou selecione uma amostra de voz."
                        : "Gerar narração local e alinhar word_id"
                }
                onClick={() => void handleGenerateTtsClick()}
              >
                <Sparkles size={12} />
                {d.busyGenerateTts || (d.renderProgress.active && isTtsStage)
                  ? "Sintetizando & Alinhando..."
                  : "Gerar Narração & Alinhar"}
              </button>

              {showTtsProgress && (
                <div className="tts-progress-box" data-testid="audio-tts-progress">
                  <div className="field-label" style={{ marginBottom: 3 }}>
                    <span>SSE · {d.renderProgress.stage}</span>
                    <span className="mono">
                      {Math.round(d.renderProgress.progressPct)}%
                    </span>
                  </div>
                  <div className="progress-track">
                    <div
                      className={`progress-fill ${
                        d.renderProgress.progressPct >= 100 && !d.renderProgress.error
                          ? "done"
                          : ""
                      }`}
                      style={{
                        width: `${Math.min(
                          100,
                          Math.max(0, d.renderProgress.progressPct)
                        )}%`,
                      }}
                    />
                  </div>
                  <div
                    className="tts-progress-msg"
                    style={{
                      color: d.renderProgress.error
                        ? "#ff8c7d"
                        : "var(--text-secondary)",
                    }}
                  >
                    {d.renderProgress.message}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SEÇÃO UNIFICADA (VISÍVEL NAS 2 ABAS): Player + Alinhamento */}
        <div className="audio-unified-section">
          {audioSrc && d.hasAudio && (
            <div>
              <div className="field-label">
                <span>Narração Master</span>
                <span className="mono" style={{ color: "var(--status-ok)" }}>
                  PRONTO
                </span>
              </div>
              <audio
                className="audio-player"
                controls
                src={audioSrc}
                preload="metadata"
              />
            </div>
          )}

          <div className="audio-alignment-bar">
            <span style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>
              Alinhamento <code className="mono">word_id</code>
            </span>
            <span
              className="mono"
              style={{ fontSize: 11.5, fontWeight: 600 }}
              data-testid="audio-alignment-summary"
            >
              {d.alignment
                ? `${wordCount} palavras · ${durationSec}s`
                : "Não alinhado"}
            </span>
          </div>

          {d.alignment && (
            <div className="scene-meta-row">
              <span className="pill" data-testid="audio-alignment-engine">
                {d.alignment.alignment_engine}
              </span>
              <span className="pill">{d.alignment.sample_rate_hz / 1000}kHz</span>
              <span className="pill pill-ok">{d.alignment.audio_source}</span>
            </div>
          )}
        </div>
      </div>

      {/* RODAPÉ UNIFICADO (VISÍVEL NAS 2 ABAS) */}
      <div className="node-footer nodrag nowheel">
        <button
          type="button"
          className="btn btn-sm"
          disabled={!d.canAlign || d.busyAlign}
          onClick={() => void d.onAlignAudio("pilot")}
          title="Gerar áudio piloto local ($0) e alinhar palavras"
        >
          Áudio Piloto $0
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          data-testid="btn-realign-audio"
          disabled={!d.canAlign || d.busyAlign}
          onClick={() =>
            void d.onAlignAudio(d.hasAudio ? "recorded" : "pilot")
          }
        >
          <AudioWaveform size={13} />
          {d.busyAlign ? "Alinhando..." : "Re-alinhar word_id"}
        </button>
      </div>

      <Handle type="source" position={Position.Right} id="audio-out" />
    </div>
  );
}
