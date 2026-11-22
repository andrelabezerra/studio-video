// app/src/components/ScenePreviewModal.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  Copy,
  ImagePlus,
  MapPin,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Shield,
  SkipBack,
  SkipForward,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { studioApi } from "../services/api";
import type {
  AlignedWord,
  ProjectDetail,
  ReviewPin,
  SceneData,
  SceneStatus,
  ScriptureRef,
  TemplateManifestItem,
  Tier2CatalogResponse,
  Tier2GenerateResponse,
} from "../types/studio";

interface ScenePreviewModalProps {
  project: ProjectDetail;
  scene: SceneData | null;
  templates: TemplateManifestItem[];
  tier2Catalog: Tier2CatalogResponse;
  mediaRevision: number;
  busySave: boolean;
  busyRegen: boolean;
  busyAsset: boolean;
  busyPin?: boolean;
  busyTier2?: boolean;
  onClose: () => void;
  onSaveScene: (
    sceneId: string,
    patch: Partial<SceneData>
  ) => Promise<SceneData | undefined>;
  onRegenerateScene: (
    sceneId: string,
    profile?: "preview" | "final"
  ) => Promise<unknown>;
  onUploadAsset: (
    sceneId: string,
    file: File,
    assetId?: string
  ) => Promise<unknown>;
  onAddPin: (
    sceneId: string,
    payload: { x_pct: number; y_pct: number; time_ms: number; note: string }
  ) => Promise<{ scene: SceneData; pin: ReviewPin } | null>;
  onTogglePin: (
    sceneId: string,
    pinId: string,
    resolved: boolean
  ) => Promise<{ scene: SceneData; pin: ReviewPin } | null>;
  onDeletePin: (sceneId: string, pinId: string) => Promise<SceneData | null>;
  onGenerateTier2: (
    sceneId: string,
    payload: { model_id: string; prompt: string; simulate_local?: boolean }
  ) => Promise<Tier2GenerateResponse | null>;
  onCopyPrompt: (prompt: string) => void;
  onRegisterTogglePlay?: (fn: (() => void) | null) => void;
}

function buildSceneWords(project: ProjectDetail, scene: SceneData): AlignedWord[] {
  const allWords = project.audio_alignment?.words || [];
  if (allWords.length > 0) {
    const startIdx = allWords.findIndex(
      (w) => w.word_id === scene.timing.start_word_id
    );
    const endIdx = allWords.findIndex(
      (w) => w.word_id === scene.timing.end_word_id
    );
    if (startIdx >= 0 && endIdx >= startIdx) {
      return allWords.slice(startIdx, endIdx + 1);
    }
    const startMs = scene.timing.resolved_start_ms ?? 0;
    const endMs = scene.timing.resolved_end_ms ?? startMs + 3500;
    const byTime = allWords.filter(
      (w) => w.start_ms >= startMs - 40 && w.end_ms <= endMs + 80
    );
    if (byTime.length > 0) return byTime;
  }

  // Fallback sintético para cenas recém-geradas antes do alinhamento de áudio
  const seg = project.script?.narration_segments[scene.order - 1];
  const fallbackText =
    seg?.display_text ||
    `${scene.visual.headline} ${scene.visual.subtext || ""}`.trim();
  const tokens = fallbackText.split(/\s+/).filter(Boolean);
  const dur = 3500;
  const step = tokens.length > 0 ? Math.floor(dur / tokens.length) : 300;
  return tokens.map((text, idx) => ({
    word_id: `preview_w_${idx}`,
    segment_id: seg?.segment_id || `seg_${scene.order}`,
    text,
    start_ms: idx * step,
    end_ms: (idx + 1) * step - 20,
    confidence: 1,
  }));
}

function resolveScriptureRef(
  project: ProjectDetail,
  scene: SceneData
): ScriptureRef | null {
  const refs = project.script?.scripture_refs || [];
  if (refs.length === 0) return null;
  if (scene.visual.scripture_ref_id) {
    const found = refs.find((r) => r.ref_id === scene.visual.scripture_ref_id);
    if (found) return found;
  }
  if (scene.template === "bible_quote_card") {
    return refs[0];
  }
  return null;
}

export function ScenePreviewModal({
  project,
  scene,
  templates,
  tier2Catalog,
  mediaRevision,
  busySave,
  busyRegen,
  busyAsset,
  busyPin = false,
  busyTier2 = false,
  onClose,
  onSaveScene,
  onRegenerateScene,
  onUploadAsset,
  onAddPin,
  onTogglePin,
  onDeletePin,
  onGenerateTier2,
  onCopyPrompt,
  onRegisterTogglePlay,
}: ScenePreviewModalProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pinInputRef = useRef<HTMLInputElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const playStartRef = useRef<{ wallMs: number; offsetMs: number } | null>(null);

  const [draft, setDraft] = useState<SceneData | null>(scene);
  const [iframeReady, setIframeReady] = useState(false);
  const [stageLoaded, setStageLoaded] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);
  const [showSafeZones, setShowSafeZones] = useState(false);
  const [timeMs, setTimeMs] = useState(900);
  const [isPlaying, setIsPlaying] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Fase 4: Pins de Revisão (x%, y%, time_ms)
  const [pinMode, setPinMode] = useState(false);
  const [pinCoords, setPinCoords] = useState<{ x_pct: number; y_pct: number }>({
    x_pct: 50,
    y_pct: 50,
  });
  const [pinNote, setPinNote] = useState("");

  // Fase 4: Nível 2 Cirúrgico
  const defaultTier2ModelId =
    tier2Catalog.models[0]?.model_id ||
    tier2Catalog.models[0]?.id ||
    "hailuo_3";
  const [selectedTier2Model, setSelectedTier2Model] =
    useState<string>(defaultTier2ModelId);

  // Sincroniza quando troca de cena ou quando review_pins/assets mudam externamente
  const prevSceneIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!scene) {
      setDraft(null);
      prevSceneIdRef.current = null;
      return;
    }
    if (prevSceneIdRef.current !== scene.scene_id) {
      prevSceneIdRef.current = scene.scene_id;
      setDraft(scene);
      setStageError(null);
      setIsPlaying(false);
      setPinMode(false);
      setPinCoords({ x_pct: 50, y_pct: 50 });
      setPinNote("");
    } else {
      setDraft((prev) =>
        prev
          ? {
              ...prev,
              review_pins: scene.review_pins,
              assets: scene.assets,
              cost_usd: scene.cost_usd,
              tier: scene.tier,
              cache_hash: scene.cache_hash,
            }
          : scene
      );
    }
  }, [scene]);

  const sceneStartMs = draft?.timing.resolved_start_ms ?? 0;
  const durationMs = useMemo(() => {
    if (!draft) return 3500;
    const s = draft.timing.resolved_start_ms;
    const e = draft.timing.resolved_end_ms;
    if (s !== null && e !== null && e > s) return Math.max(500, e - s);
    return 3500;
  }, [draft]);

  const activeTemplateInfo = useMemo(() => {
    if (!draft) return null;
    return (
      templates.find((t) => t.id === draft.template) ||
      templates.find((t) => t.id === "paper_collage") ||
      null
    );
  }, [draft, templates]);

  const getFieldMeta = useCallback(
    (
      key: "headline" | "subtext" | "original_term" | "stamp_text",
      fallbackLabel: string,
      fallbackPlaceholder: string
    ) => {
      const found = activeTemplateInfo?.editable_fields?.find(
        (f) => f.key === key
      );
      return {
        label: found?.label || fallbackLabel,
        placeholder: found?.placeholder || fallbackPlaceholder,
      };
    },
    [activeTemplateInfo]
  );

  const stopPlayback = useCallback(() => {
    setIsPlaying(false);
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
    }
  }, []);

  const postToStage = useCallback((msg: Record<string, unknown>) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(msg, window.location.origin);
  }, []);

  const sendLoadScene = useCallback(
    (targetScene: SceneData, initialSeekMs: number, safeZonesFlag: boolean) => {
      const assetUrls: Record<string, string> = {};
      for (const a of targetScene.assets) {
        if (a.cache_relpath) {
          assetUrls[a.asset_id] = studioApi.mediaUrl(
            project.manifest.slug,
            a.cache_relpath,
            mediaRevision
          );
        }
      }

      const payload = {
        scene: targetScene,
        preset: project.preset,
        format_type: project.manifest.series.format_type,
        scene_start_ms: targetScene.timing.resolved_start_ms ?? 0,
        duration_ms: durationMs,
        words: buildSceneWords(project, targetScene),
        asset_urls: assetUrls,
        scripture_ref: resolveScriptureRef(project, targetScene),
        show_safe_zones: safeZonesFlag,
        captions_enabled: project.storyboard?.captions_enabled ?? true,
      };

      postToStage({
        type: "STUDIO_LOAD_SCENE",
        payload,
        initialTimeMs: initialSeekMs,
      });
    },
    [project, durationMs, mediaRevision, postToStage]
  );

  // Escuta respostas do iframe (STUDIO_READY / STUDIO_SCENE_LOADED / STUDIO_ERROR)
  useEffect(() => {
    if (!scene) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as
        | { type?: string; message?: string }
        | null
        | undefined;
      if (!data || typeof data !== "object") return;

      if (data.type === "STUDIO_READY") {
        setIframeReady(true);
      } else if (data.type === "STUDIO_SCENE_LOADED") {
        setStageLoaded(true);
        setStageError(null);
      } else if (data.type === "STUDIO_ERROR") {
        setStageError(data.message || "Erro ao renderizar template no palco.");
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [scene]);

  // Quando iframe ficar pronto ou a cena mudar, envia STUDIO_LOAD_SCENE
  useEffect(() => {
    if (!draft || !iframeReady) return;
    const initial = Math.min(1100, Math.round(durationMs * 0.35));
    setTimeMs(initial);
    sendLoadScene(draft, initial, showSafeZones);
  }, [iframeReady, draft?.scene_id, mediaRevision]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup ao fechar
  useEffect(() => {
    return () => {
      stopPlayback();
    };
  }, [stopPlayback]);

  const seekTo = useCallback(
    (nextMs: number) => {
      const clamped = Math.max(0, Math.min(durationMs, nextMs));
      setTimeMs(clamped);
      postToStage({ type: "STUDIO_SEEK", timeMs: clamped });
    },
    [durationMs, postToStage]
  );

  const toggleSafeZones = (checked: boolean) => {
    setShowSafeZones(checked);
    postToStage({ type: "STUDIO_SAFE_ZONES", show: checked });
  };

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      stopPlayback();
      return;
    }

    const startOffset = timeMs >= durationMs - 40 ? 0 : timeMs;
    setIsPlaying(true);

    const audioEl = audioRef.current;
    const hasSyncedAudio =
      Boolean(
        audioEl && project.artifacts.has_audio && project.artifacts.audio_url
      ) && draft?.timing.resolved_start_ms !== null;

    if (hasSyncedAudio && audioEl) {
      audioEl.currentTime = (sceneStartMs + startOffset) / 1000;
      audioEl.play().catch((err) => {
        console.warn("[Studio Preview] Autoplay de áudio bloqueado:", err);
      });
    }

    playStartRef.current = { wallMs: performance.now(), offsetMs: startOffset };

    const tick = (now: number) => {
      let nextMs: number;
      if (hasSyncedAudio && audioEl && !audioEl.paused) {
        nextMs = audioEl.currentTime * 1000 - sceneStartMs;
      } else {
        const base = playStartRef.current!;
        nextMs = base.offsetMs + (now - base.wallMs);
      }

      if (nextMs >= durationMs) {
        seekTo(durationMs);
        stopPlayback();
        return;
      }

      seekTo(nextMs);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [
    isPlaying,
    stopPlayback,
    timeMs,
    durationMs,
    project.artifacts.has_audio,
    project.artifacts.audio_url,
    draft?.timing.resolved_start_ms,
    sceneStartMs,
    seekTo,
  ]);

  useEffect(() => {
    onRegisterTogglePlay?.(togglePlay);
    return () => onRegisterTogglePlay?.(null);
  }, [onRegisterTogglePlay, togglePlay]);

  if (!scene || !draft) return null;

  const primaryAsset = draft.assets[0];
  const promptText =
    primaryAsset?.prompt ||
    `Editorial Vox style paper collage cutout for '${draft.visual.headline}', warm parchment tones, torn paper edges, subtle drop shadow`;

  const headlineMeta = getFieldMeta(
    "headline",
    "Headline da Cena",
    "MAKÁRIOS"
  );
  const subtextMeta = getFieldMeta(
    "subtext",
    "Subtext / Rótulo",
    "Grego · Mateus 5"
  );
  const originalTermMeta = getFieldMeta(
    "original_term",
    "Termo Original / Rota (Origem → Destino)",
    "Cafarnaum → Jerusalém"
  );
  const stampTextMeta = getFieldMeta(
    "stamp_text",
    "Carimbo / Selo Editorial",
    "ROTA HISTÓRICA"
  );

  const handleSaveAndPreview = async () => {
    const saved = await onSaveScene(draft.scene_id, {
      template: draft.template,
      tier: draft.template === "tier2_video" ? 2 : draft.tier,
      status: draft.status,
      visual: draft.visual,
      assets: draft.assets,
    });
    const finalScene = saved || draft;
    setDraft(finalScene);
    sendLoadScene(finalScene, timeMs, showSafeZones);
  };

  const handleApprove = async () => {
    const updated: SceneData = { ...draft, status: "approved" };
    setDraft(updated);
    await onSaveScene(draft.scene_id, {
      status: "approved",
      template: updated.template,
      visual: updated.visual,
    });
  };

  const handleFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    await onUploadAsset(draft.scene_id, file, primaryAsset?.asset_id);
  };

  const handleStageOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pinMode) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const xPct = Math.max(
      4,
      Math.min(
        96,
        Number((((e.clientX - rect.left) / rect.width) * 100).toFixed(1))
      )
    );
    const yPct = Math.max(
      4,
      Math.min(
        96,
        Number((((e.clientY - rect.top) / rect.height) * 100).toFixed(1))
      )
    );
    stopPlayback();
    setPinCoords({ x_pct: xPct, y_pct: yPct });
    pinInputRef.current?.focus();
  };

  const handleCreatePin = async () => {
    const cleanNote = pinNote.trim() || "Revisar ponto marcado no palco 9:16";
    const res = await onAddPin(draft.scene_id, {
      x_pct: pinCoords.x_pct,
      y_pct: pinCoords.y_pct,
      time_ms: Math.round(timeMs),
      note: cleanNote,
    });
    if (res) {
      setDraft((prev) =>
        prev
          ? {
              ...prev,
              review_pins: res.scene.review_pins,
              status: res.scene.status,
            }
          : res.scene
      );
      setPinNote("");
      setPinMode(false);
    }
  };

  const handleTogglePinResolved = async (pin: ReviewPin) => {
    const res = await onTogglePin(draft.scene_id, pin.pin_id, !pin.resolved);
    if (res) {
      setDraft((prev) =>
        prev
          ? {
              ...prev,
              review_pins: res.scene.review_pins,
            }
          : res.scene
      );
    }
  };

  const handleDeletePin = async (pinId: string) => {
    const updatedScene = await onDeletePin(draft.scene_id, pinId);
    if (updatedScene) {
      setDraft((prev) =>
        prev
          ? {
              ...prev,
              review_pins: updatedScene.review_pins,
            }
          : updatedScene
      );
    }
  };

  const handleRunTier2 = async (simulateLocal: boolean) => {
    const res = await onGenerateTier2(draft.scene_id, {
      model_id: selectedTier2Model,
      prompt: promptText,
      simulate_local: simulateLocal,
    });
    if (res) {
      setDraft(res.scene);
      sendLoadScene(res.scene, timeMs, showSafeZones);
    }
  };

  const selectedModelInfo =
    tier2Catalog.models.find(
      (m) => (m.model_id || m.id) === selectedTier2Model
    ) || tier2Catalog.models[0];

  const spentTotal = project.manifest.cost_ledger.spent_total ?? 0;
  const videoCap =
    project.manifest.cost_ledger.cap_usd ?? tier2Catalog.max_cost_per_video_usd;
  const reviewPins = draft.review_pins || [];
  const currentFrame = Math.round((timeMs / 1000) * 30);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card preview-modal"
        data-testid="scene-preview-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Preview ao vivo ${draft.scene_id}`}
      >
        <div className="modal-header">
          <div className="modal-title">
            <span className="node-step-badge">
              {draft.scene_id.toUpperCase()}
            </span>
            <span>Preview Ao Vivo 9:16 · Palco Vox Bíblico</span>
            <span className="pill pill-blue">{draft.template}</span>
            <span className="pill">
              Nível {draft.tier} · ${draft.cost_usd.toFixed(2)}
            </span>
            {reviewPins.length > 0 && (
              <span className="pill pill-gold">
                📍 {reviewPins.filter((p) => !p.resolved).length}/
                {reviewPins.length} pins
              </span>
            )}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={onClose}
            aria-label="Fechar preview"
          >
            <X size={16} />
          </button>
        </div>

        <div className="preview-modal-body">
          {/* Esquerda: Palco <iframe> 9:16 + Overlay de Pins + Transport */}
          <div className="preview-stage-col">
            <div className="stage-pin-toolbar">
              <button
                type="button"
                className={`btn btn-xs ${pinMode ? "btn-primary" : ""}`}
                data-testid="btn-toggle-pin-mode"
                aria-pressed={pinMode}
                onClick={() => setPinMode((v) => !v)}
                title="Ativar modo Pin para clicar sobre o palco 9:16 e registrar nota com coordenada (x%, y%) e timestamp"
              >
                <MapPin size={12} />
                📍 Modo Pin {pinMode ? "(Ativo — clique no palco)" : ""}
              </button>
              <span className="mono stage-pin-coords-hint">
                ({pinCoords.x_pct.toFixed(0)}%, {pinCoords.y_pct.toFixed(0)}%) @{" "}
                {(timeMs / 1000).toFixed(1)}s
              </span>
            </div>

            <div className="stage-iframe-shell">
              <iframe
                ref={iframeRef}
                className="stage-iframe"
                src="/templates_video/stage.html"
                title={`Palco ao vivo ${draft.scene_id}`}
                onLoad={() => {
                  setIframeReady(true);
                  postToStage({ type: "STUDIO_PING" });
                }}
              />

              {/* Camada de captura de clique quando Modo Pin está ativo */}
              {pinMode && (
                <div
                  className="stage-pin-click-overlay"
                  data-testid="stage-pin-overlay"
                  onClick={handleStageOverlayClick}
                  title="Clique para posicionar o Pin de Revisão"
                >
                  <div
                    className="stage-pin-cursor-preview"
                    style={{
                      left: `${pinCoords.x_pct}%`,
                      top: `${pinCoords.y_pct}%`,
                    }}
                  >
                    +
                  </div>
                </div>
              )}

              {/* Marcadores visuais numerados (1, 2...) sobre o palco 9:16 */}
              <div className="stage-pins-layer">
                {reviewPins.map((pin, idx) => (
                  <button
                    key={pin.pin_id}
                    type="button"
                    className={`stage-pin-marker ${
                      pin.resolved ? "resolved" : "open"
                    }`}
                    data-testid={`stage-pin-marker-${pin.pin_id}`}
                    data-pin-number={idx + 1}
                    style={{
                      left: `${pin.x_pct}%`,
                      top: `${pin.y_pct}%`,
                    }}
                    title={`#${idx + 1} (${(pin.time_ms / 1000).toFixed(
                      1
                    )}s): ${pin.note}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      stopPlayback();
                      seekTo(pin.time_ms);
                    }}
                  >
                    {idx + 1}
                  </button>
                ))}
              </div>

              {!stageLoaded && !stageError && (
                <div className="stage-loading-badge">
                  Carregando palco Vox...
                </div>
              )}
              {stageError && (
                <div
                  className="stage-loading-badge"
                  style={{ color: "#ff8c7d", padding: 16 }}
                >
                  {stageError}
                </div>
              )}
            </div>

            {project.artifacts.has_audio && project.artifacts.audio_url && (
              <audio
                ref={audioRef}
                src={`${project.artifacts.audio_url}?v=${mediaRevision}`}
                preload="auto"
              />
            )}

            <div className="stage-transport">
              <div className="transport-row">
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    data-testid="btn-preview-play"
                    aria-pressed={isPlaying}
                    data-playing={isPlaying ? "true" : "false"}
                    onClick={togglePlay}
                    title="Reproduzir / Pausar (Atalho: Espaço)"
                  >
                    {isPlaying ? <Pause size={13} /> : <Play size={13} />}
                    {isPlaying ? "Pause" : "Play"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      stopPlayback();
                      seekTo(timeMs - 33.33);
                    }}
                    title="Voltar 1 frame (33ms)"
                  >
                    <SkipBack size={12} /> -1f
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      stopPlayback();
                      seekTo(timeMs + 33.33);
                    }}
                    title="Avançar 1 frame (33ms)"
                  >
                    +1f <SkipForward size={12} />
                  </button>
                </div>

                <span
                  className="mono"
                  style={{ fontSize: 11, color: "var(--vox-gold)" }}
                >
                  {Math.round(timeMs)}ms · f
                  {String(currentFrame).padStart(3, "0")}
                </span>
              </div>

              <input
                type="range"
                className="scrubber"
                data-testid="stage-scrubber"
                aria-label="Linha do tempo da cena"
                min={0}
                max={durationMs}
                step={16}
                value={Math.round(timeMs)}
                onChange={(e) => {
                  stopPlayback();
                  seekTo(Number(e.target.value));
                }}
              />

              <div className="transport-row">
                <label className="scripture-check" style={{ fontSize: 11.5 }}>
                  <input
                    type="checkbox"
                    checked={showSafeZones}
                    onChange={(e) => toggleSafeZones(e.target.checked)}
                  />
                  <Shield size={13} color="#E5A93C" />
                  <span>Safe-Zones 9:16 (Shorts / Reels / TikTok)</span>
                </label>
                <span
                  className="mono"
                  style={{ fontSize: 10.5, color: "var(--text-muted)" }}
                >
                  {(durationMs / 1000).toFixed(2)}s
                </span>
              </div>
            </div>
          </div>

          {/* Direita: Inspetor da Cena + Templates + Pins + Nível 2 */}
          <div className="preview-inspector-col">
            <div className="grid-2">
              <div>
                <label className="field-label">Template Plugável</label>
                <select
                  className="select mono"
                  data-testid="select-scene-template"
                  aria-label="Template Nível 1"
                  value={draft.template}
                  onChange={(e) => {
                    const nextTpl = e.target.value;
                    const nextScene: SceneData = {
                      ...draft,
                      template: nextTpl,
                      tier: nextTpl === "tier2_video" ? 2 : 1,
                    };
                    setDraft(nextScene);
                    sendLoadScene(nextScene, timeMs, showSafeZones);
                  }}
                >
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.id} — {tpl.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">Tema de Fundo</label>
                <select
                  className="select"
                  value={draft.visual.background_theme}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      visual: {
                        ...draft.visual,
                        background_theme: e.target.value,
                      },
                    })
                  }
                >
                  <option value="pergaminho">Pergaminho (#F4EDE1)</option>
                  <option value="carvao">Carvão Noturno (#181A1F)</option>
                  <option value="azul_marinho">Azul Histórico (#1E3A5F)</option>
                </select>
              </div>
            </div>

            {activeTemplateInfo && (
              <div
                className="template-manifest-banner"
                data-testid="template-manifest-info"
              >
                <div className="template-manifest-head">
                  <strong>{activeTemplateInfo.label}</strong>
                  <span className="pill pill-gold">
                    Nível {activeTemplateInfo.tier} · $
                    {activeTemplateInfo.default_cost_usd.toFixed(2)}
                  </span>
                </div>
                <div className="template-manifest-desc">
                  {activeTemplateInfo.description}
                </div>
              </div>
            )}

            <div className="grid-2">
              <div>
                <label className="field-label">{headlineMeta.label}</label>
                <input
                  className="input"
                  data-testid="input-scene-headline"
                  placeholder={headlineMeta.placeholder}
                  value={draft.visual.headline}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      visual: { ...draft.visual, headline: e.target.value },
                    })
                  }
                />
              </div>
              <div>
                <label className="field-label">{subtextMeta.label}</label>
                <input
                  className="input"
                  data-testid="input-scene-subtext"
                  placeholder={subtextMeta.placeholder}
                  value={draft.visual.subtext || ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      visual: {
                        ...draft.visual,
                        subtext: e.target.value || null,
                      },
                    })
                  }
                />
              </div>
            </div>

            <div className="grid-2">
              <div>
                <label className="field-label">{originalTermMeta.label}</label>
                <input
                  className="input"
                  data-testid="input-scene-original-term"
                  name="original_term"
                  placeholder={originalTermMeta.placeholder}
                  value={draft.visual.original_term || ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      visual: {
                        ...draft.visual,
                        original_term: e.target.value || null,
                      },
                    })
                  }
                />
              </div>
              <div>
                <label className="field-label">{stampTextMeta.label}</label>
                <input
                  className="input"
                  data-testid="input-scene-stamp-text"
                  name="stamp_text"
                  placeholder={stampTextMeta.placeholder}
                  value={draft.visual.stamp_text || ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      visual: {
                        ...draft.visual,
                        stamp_text: e.target.value || null,
                      },
                    })
                  }
                />
              </div>
            </div>

            <div className="grid-2">
              <div>
                <label className="field-label">Transição de Entrada</label>
                <select
                  className="select mono"
                  value={draft.visual.transition_in}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      visual: { ...draft.visual, transition_in: e.target.value },
                    })
                  }
                >
                  <option value="paper_tear">paper_tear (Rasgo de Papel)</option>
                  <option value="stamp_drop">stamp_drop (Carimbo)</option>
                  <option value="whip_pan">whip_pan (Chicote Rápido)</option>
                  <option value="cut">cut (Corte Limpo)</option>
                </select>
              </div>
              <div>
                <label className="field-label">Status da Cena</label>
                <select
                  className="select mono"
                  value={draft.status}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      status: e.target.value as SceneStatus,
                    })
                  }
                >
                  <option value="draft">draft</option>
                  <option value="approved">approved</option>
                  <option value="needs_revision">needs_revision</option>
                  <option value="rendered">rendered</option>
                </select>
              </div>
            </div>

            {/* Seção: Pins de Revisão (x%, y%, time_ms) */}
            <div className="refine-box" data-testid="inspector-pins-section">
              <div className="field-label" style={{ marginBottom: 2 }}>
                <span>
                  📍 Pins de Revisão ({reviewPins.length}) ·{" "}
                  <span className="mono" style={{ color: "var(--vox-gold)" }}>
                    {pinCoords.x_pct.toFixed(0)}%, {pinCoords.y_pct.toFixed(0)}%
                    @ {(timeMs / 1000).toFixed(1)}s
                  </span>
                </span>
                <button
                  type="button"
                  className="btn btn-xs"
                  onClick={() => {
                    setPinMode(true);
                    pinInputRef.current?.focus();
                  }}
                >
                  <MapPin size={11} /> Mirar no Palco
                </button>
              </div>

              <div className="refine-row">
                <input
                  ref={pinInputRef}
                  className="input"
                  data-testid="input-pin-note"
                  placeholder="Nota de revisão (ex.: Destacar rota da Galileia em dourado)..."
                  value={pinNote}
                  onChange={(e) => setPinNote(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleCreatePin();
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  data-testid="btn-add-pin"
                  disabled={busyPin}
                  onClick={() => void handleCreatePin()}
                >
                  <Plus size={12} />
                  Salvar Pin
                </button>
              </div>

              {reviewPins.length > 0 && (
                <div className="pins-inspector-list" data-testid="pins-list">
                  {reviewPins.map((pin, idx) => (
                    <div
                      key={pin.pin_id}
                      className={`pin-item-row ${
                        pin.resolved ? "resolved" : ""
                      }`}
                      data-testid={`pin-row-${pin.pin_id}`}
                    >
                      <button
                        type="button"
                        className={`pin-num-badge ${
                          pin.resolved ? "resolved" : ""
                        }`}
                        onClick={() => {
                          stopPlayback();
                          seekTo(pin.time_ms);
                        }}
                        title="Ir para o instante deste pin"
                      >
                        {idx + 1}
                      </button>

                      <div
                        className="pin-item-content"
                        onClick={() => {
                          stopPlayback();
                          seekTo(pin.time_ms);
                        }}
                      >
                        <div className="pin-item-meta mono">
                          <span>{(pin.time_ms / 1000).toFixed(1)}s</span>
                          <span>
                            ({pin.x_pct.toFixed(0)}%, {pin.y_pct.toFixed(0)}%)
                          </span>
                          <span
                            className={`pill ${
                              pin.resolved ? "pill-ok" : "pill-gold"
                            }`}
                          >
                            {pin.resolved ? "resolvido" : "aberto"}
                          </span>
                        </div>
                        <div className="pin-item-note">{pin.note}</div>
                      </div>

                      <div className="pin-item-actions">
                        <button
                          type="button"
                          className="btn btn-xs"
                          data-testid={`btn-toggle-pin-${pin.pin_id}`}
                          disabled={busyPin}
                          onClick={() => void handleTogglePinResolved(pin)}
                          title={
                            pin.resolved ? "Reabrir Pin" : "Marcar como Resolvido"
                          }
                        >
                          {pin.resolved ? (
                            <>
                              <RotateCcw size={11} /> Reabrir
                            </>
                          ) : (
                            <>
                              <CheckCircle2 size={11} color="#34d399" />{" "}
                              Resolver
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-xs"
                          data-testid={`btn-delete-pin-${pin.pin_id}`}
                          disabled={busyPin}
                          onClick={() => void handleDeletePin(pin.pin_id)}
                          title="Excluir Pin"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Prompt Pack Gemini PRO + Dropzone */}
            <div className="refine-box">
              <div className="field-label" style={{ marginBottom: 2 }}>
                <span>Prompt Pack Gemini PRO (Modo Híbrido $0)</span>
                <button
                  type="button"
                  className="btn btn-xs"
                  onClick={() => onCopyPrompt(promptText)}
                >
                  <Copy size={11} /> Copiar Prompt
                </button>
              </div>
              <textarea
                className="textarea mono"
                style={{ fontSize: 11.5, minHeight: 60 }}
                value={promptText}
                onChange={(e) => {
                  const nextPrompt = e.target.value;
                  const nextAssets =
                    draft.assets.length > 0
                      ? draft.assets.map((a, i) =>
                          i === 0 ? { ...a, prompt: nextPrompt } : a
                        )
                      : [
                          {
                            asset_id: `img_${draft.scene_id}`,
                            provider: "gemini_hybrid",
                            prompt: nextPrompt,
                            apply_rembg: true,
                            cache_relpath: null,
                            sha256: null,
                          },
                        ];
                  setDraft({ ...draft, assets: nextAssets });
                }}
              />

              <div
                className={`dropzone ${dragging ? "dragging" : ""}`}
                onClick={() => fileRef.current?.click()}
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
                    gap: 6,
                    fontWeight: 600,
                  }}
                >
                  <ImagePlus size={14} color="#E5A93C" />
                  {busyAsset
                    ? "Redimensionando e salvando no cache..."
                    : primaryAsset?.cache_relpath
                      ? `Arte atual: ${primaryAsset.cache_relpath} (clique para trocar)`
                      : "Arraste aqui a imagem baixada do Gemini PRO Web"}
                </div>
              </div>
            </div>

            {/* Painel Nível 2 Cirúrgico sob Teto USD */}
            <div className="refine-box tier2-box" data-testid="tier2-inspector-box">
              <div className="field-label" style={{ marginBottom: 2 }}>
                <span>
                  <Sparkles size={11} color="#E5A93C" /> Nível 2 Cirúrgico & 3D
                  (Sob Teto USD)
                </span>
                <span className="pill">
                  Teto Cena: ${tier2Catalog.max_cost_per_scene_usd.toFixed(2)} ·
                  Vídeo: ${spentTotal.toFixed(2)}/${videoCap.toFixed(2)}
                </span>
              </div>

              <div className="grid-2" style={{ alignItems: "center" }}>
                <select
                  className="select mono"
                  data-testid="select-tier2-model"
                  aria-label="Selecionar modelo Nível 2"
                  value={selectedTier2Model}
                  onChange={(e) => setSelectedTier2Model(e.target.value)}
                >
                  {tier2Catalog.models.map((m) => {
                    const mId = m.model_id || m.id || "hailuo_3";
                    return (
                      <option key={mId} value={mId}>
                        {m.label} (${m.cost_usd.toFixed(2)})
                      </option>
                    );
                  })}
                </select>

                <div className="tier2-guardrail-pills">
                  <span
                    className={`pill ${
                      tier2Catalog.enable_tier2_video ? "pill-ok" : "pill-alert"
                    }`}
                  >
                    Vídeo API:{" "}
                    {tier2Catalog.enable_tier2_video ? "ON" : "OFF (.env)"}
                  </span>
                  <span
                    className={`pill ${
                      tier2Catalog.enable_fal_3d ? "pill-ok" : "pill-alert"
                    }`}
                  >
                    Fal 3D: {tier2Catalog.enable_fal_3d ? "ON" : "OFF (.env)"}
                  </span>
                </div>
              </div>

              <div className="tier2-actions-row">
                <button
                  type="button"
                  className="btn btn-blue btn-sm"
                  data-testid="btn-tier2-simulate"
                  disabled={busyTier2}
                  onClick={() => void handleRunTier2(true)}
                  title="Gera composição editorial 9:16 localmente sem custo de API ($0.00)"
                >
                  <Sparkles size={12} />
                  {busyTier2
                    ? "Gerando..."
                    : "Simular Nível 2 Local ($0.00)"}
                </button>

                <button
                  type="button"
                  className="btn btn-sm"
                  data-testid="btn-tier2-generate-paid"
                  disabled={busyTier2}
                  onClick={() => void handleRunTier2(false)}
                  title="Executa via provedor configurado respeitando ENABLE_TIER2_VIDEO / ENABLE_FAL_3D e teto USD"
                >
                  Gerar via API Paga ($
                  {(selectedModelInfo?.cost_usd ?? 0.19).toFixed(2)})
                </button>
              </div>
            </div>

            <div
              className="mono"
              style={{ fontSize: 11, color: "var(--text-muted)" }}
            >
              Âncora word_id: {draft.timing.start_word_id} →{" "}
              {draft.timing.end_word_id}
              {draft.cache_hash
                ? ` · hash ${draft.cache_hash.slice(0, 10)}`
                : ""}
            </div>

            <div className="inspector-actions">
              <button
                type="button"
                className="btn btn-primary"
                data-testid="btn-save-scene-preview"
                disabled={busySave}
                onClick={() => void handleSaveAndPreview()}
              >
                <Save size={13} />
                {busySave ? "Salvando..." : "Salvar & Atualizar Preview"}
              </button>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-blue"
                  disabled={busyRegen}
                  onClick={() =>
                    void onRegenerateScene(draft.scene_id, "preview")
                  }
                >
                  <RefreshCw size={13} />
                  {busyRegen ? "Regenerando..." : "Regenerar Cena (MP4)"}
                </button>

                <button
                  type="button"
                  className="btn btn-success"
                  disabled={busySave}
                  onClick={() => void handleApprove()}
                >
                  <Check size={13} />
                  Aprovar Cena
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
