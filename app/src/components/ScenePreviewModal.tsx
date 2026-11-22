// app/src/components/ScenePreviewModal.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Film,
  Image as ImageIcon,
  ImagePlus,
  Layers,
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
  Type,
  X,
} from "lucide-react";
import { studioApi } from "../services/api";
import type {
  AlignedWord,
  CameraMotionMode,
  ElementAnimationMode,
  IllustrationVariant,
  ImageAnimationMode,
  ImageFitMode,
  ImageLayoutMode,
  ProjectAssetLibraryItem,
  ProjectDetail,
  ReviewPin,
  SceneData,
  SceneStatus,
  SceneVisual,
  ScriptureRef,
  TemplateManifestItem,
  Tier2CatalogResponse,
  Tier2GenerateResponse,
  TransitionIn,
} from "../types/studio";

type InspectorTab = "content" | "media" | "animation" | "pins_tier2";

interface ScenePreviewModalProps {
  project: ProjectDetail;
  scene: SceneData | null;
  templates: TemplateManifestItem[];
  tier2Catalog: Tier2CatalogResponse;
  projectAssets: ProjectAssetLibraryItem[];
  mediaRevision: number;
  busySave: boolean;
  busyRegen: boolean;
  busyAsset: boolean;
  busyPin?: boolean;
  busyTier2?: boolean;
  onClose: () => void;
  onNavigateScene?: (sceneId: string) => void;
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
    options?: { asset_id?: string; apply_rembg?: boolean }
  ) => Promise<unknown>;
  onAttachAsset?: (
    sceneId: string,
    payload: { cache_relpath: string; asset_id?: string; apply_rembg?: boolean }
  ) => Promise<unknown>;
  onDeleteAsset?: (sceneId: string, assetId?: string) => Promise<unknown>;
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

const TRANSITION_OPTIONS: Array<{ value: TransitionIn; label: string }> = [
  { value: "paper_tear", label: "Rasgo de Papel (paper_tear)" },
  { value: "stamp_drop", label: "Impacto de Carimbo (stamp_drop)" },
  { value: "whip_pan", label: "Chicote Rápido (whip_pan)" },
  { value: "fade_in", label: "Fade Editorial Suave (fade_in)" },
  { value: "slide_up", label: "Deslize de Baixo p/ Cima (slide_up)" },
  { value: "slide_left", label: "Deslize Lateral (slide_left)" },
  { value: "zoom_punch", label: "Zoom de Impacto (zoom_punch)" },
  { value: "iris_reveal", label: "Cortina Editorial (iris_reveal)" },
  { value: "cut", label: "Corte Limpo (cut)" },
];

const CAMERA_MOTION_OPTIONS: Array<{ value: CameraMotionMode; label: string }> = [
  { value: "subtle_zoom_in", label: "Zoom In Suave (Vox padrão)" },
  { value: "subtle_zoom_out", label: "Zoom Out Suave" },
  { value: "dramatic_zoom_in", label: "Zoom In Dramático" },
  { value: "pan_left", label: "Panorâmica p/ Esquerda" },
  { value: "pan_right", label: "Panorâmica p/ Direita" },
  { value: "pan_up", label: "Subida Vertical (Pan Up)" },
  { value: "pan_down", label: "Descida Vertical (Pan Down)" },
  { value: "handheld_drift", label: "Flutuação Documental Orgânica" },
  { value: "tilt_drift", label: "Inclinação Editorial Suave" },
  { value: "none", label: "Câmera Estática" },
];

const IMAGE_ANIMATION_OPTIONS: Array<{ value: ImageAnimationMode; label: string }> = [
  { value: "ken_burns_in", label: "Ken Burns — Zoom In" },
  { value: "ken_burns_out", label: "Ken Burns — Zoom Out" },
  { value: "pan_left", label: "Deslize p/ Esquerda" },
  { value: "pan_right", label: "Deslize p/ Direita" },
  { value: "float", label: "Flutuação Suave" },
  { value: "pulse", label: "Pulso Editorial" },
  { value: "tilt", label: "Inclinação Dinâmica" },
  { value: "static", label: "Estática (sem movimento)" },
];

const ELEMENT_ANIMATION_OPTIONS: Array<{ value: ElementAnimationMode; label: string }> = [
  { value: "vox_editorial", label: "Editorial Vox (nativo do template)" },
  { value: "pop_bounce", label: "Pop com Bounce" },
  { value: "slide_reveal", label: "Deslize Lateral Limpo" },
  { value: "type_fade", label: "Fade Tipográfico Suave" },
  { value: "dramatic_rise", label: "Subida Dramática" },
  { value: "minimal", label: "Minimalista Rápido" },
];

const IMAGE_LAYOUT_OPTIONS: Array<{ value: ImageLayoutMode; label: string }> = [
  { value: "auto", label: "Automático do Template" },
  { value: "card", label: "Cartão / Moldura Destacada" },
  { value: "background", label: "Fundo 9:16 com Contraste" },
  { value: "background_blur", label: "Fundo 9:16 Desfocado" },
  { value: "cutout_overlay", label: "Recorte Flutuante (PNG/Cutout)" },
  { value: "none", label: "Ocultar Foto (usar SVG/Texto)" },
];

const ILLUSTRATION_OPTIONS: Array<{ value: IllustrationVariant; label: string }> = [
  { value: "auto", label: "Automática (pelo contexto)" },
  { value: "greek_papyrus", label: "Papiro / Manuscrito Grego" },
  { value: "compass_map", label: "Mapa & Bússola Histórica" },
  { value: "editorial_loupe", label: "Arquivo & Lupa Editorial" },
  { value: "ancient_arch", label: "Arco Clássico & Sol Dourado" },
];

interface MotionPreset {
  id: string;
  label: string;
  sub: string;
  patch: Partial<SceneVisual>;
}

const MOTION_PRESETS: MotionPreset[] = [
  {
    id: "vox",
    label: "Vox Clássico",
    sub: "Rasgo + Zoom",
    patch: {
      transition_in: "paper_tear",
      camera_motion: "subtle_zoom_in",
      image_animation: "ken_burns_in",
      element_animation: "vox_editorial",
      animation_speed: 1.0,
      motion_intensity: 1.0,
    },
  },
  {
    id: "hook",
    label: "Impacto Hook",
    sub: "Carimbo + Pop",
    patch: {
      transition_in: "stamp_drop",
      camera_motion: "dramatic_zoom_in",
      image_animation: "pulse",
      element_animation: "pop_bounce",
      animation_speed: 1.25,
      motion_intensity: 1.35,
    },
  },
  {
    id: "doc",
    label: "Documental",
    sub: "Fade + Drift",
    patch: {
      transition_in: "fade_in",
      camera_motion: "handheld_drift",
      image_animation: "pan_right",
      element_animation: "type_fade",
      animation_speed: 0.85,
      motion_intensity: 0.9,
    },
  },
  {
    id: "fast",
    label: "Dinâmico",
    sub: "Chicote + 1.4x",
    patch: {
      transition_in: "whip_pan",
      camera_motion: "pan_left",
      image_animation: "ken_burns_out",
      element_animation: "slide_reveal",
      animation_speed: 1.4,
      motion_intensity: 1.3,
    },
  },
  {
    id: "clean",
    label: "Minimalista",
    sub: "Corte limpo",
    patch: {
      transition_in: "cut",
      camera_motion: "none",
      image_animation: "static",
      element_animation: "minimal",
      animation_speed: 1.0,
      motion_intensity: 0.0,
    },
  },
];

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

function normalizeCameraMotionValue(raw: string | undefined): CameraMotionMode {
  if (!raw) return "subtle_zoom_in";
  if (raw === "subtle_pan_right") return "pan_right";
  const found = CAMERA_MOTION_OPTIONS.find((opt) => opt.value === raw);
  return found ? found.value : "subtle_zoom_in";
}

function buildSanitizedVisual(visual: SceneVisual): SceneVisual {
  return {
    ...visual,
    headline: visual.headline ?? "",
    subtext: visual.subtext ?? "",
    camera_motion: visual.camera_motion || "subtle_zoom_in",
    image_layout: visual.image_layout || "auto",
    image_fit: visual.image_fit || "cover",
    image_scale: visual.image_scale ?? 1.0,
    image_offset_x: visual.image_offset_x ?? 0.0,
    image_offset_y: visual.image_offset_y ?? 0.0,
    image_opacity: visual.image_opacity ?? 1.0,
    image_animation: visual.image_animation || "ken_burns_in",
    illustration_variant: visual.illustration_variant || "auto",
    element_animation: visual.element_animation || "vox_editorial",
    animation_speed: visual.animation_speed ?? 1.0,
    motion_intensity: visual.motion_intensity ?? 1.0,
  };
}

export function ScenePreviewModal({
  project,
  scene,
  templates,
  tier2Catalog,
  projectAssets,
  mediaRevision,
  busySave,
  busyRegen,
  busyAsset,
  busyPin = false,
  busyTier2 = false,
  onClose,
  onNavigateScene,
  onSaveScene,
  onRegenerateScene,
  onUploadAsset,
  onAttachAsset,
  onDeleteAsset,
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
  const liveSyncTimerRef = useRef<number | null>(null);

  const [draft, setDraft] = useState<SceneData | null>(scene);
  const [activeTab, setActiveTab] = useState<InspectorTab>("content");
  const [isDirty, setIsDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [iframeReady, setIframeReady] = useState(false);
  const [stageLoaded, setStageLoaded] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);
  const [showSafeZones, setShowSafeZones] = useState(false);
  const [timeMs, setTimeMs] = useState(900);
  const [isPlaying, setIsPlaying] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploadApplyRembg, setUploadApplyRembg] = useState(false);

  // Pins de Revisão
  const [pinMode, setPinMode] = useState(false);
  const [pinCoords, setPinCoords] = useState<{ x_pct: number; y_pct: number }>({
    x_pct: 50,
    y_pct: 50,
  });
  const [pinNote, setPinNote] = useState("");

  // Nível 2 Cirúrgico
  const defaultTier2ModelId =
    tier2Catalog.models[0]?.model_id ||
    tier2Catalog.models[0]?.id ||
    "hailuo_3";
  const [selectedTier2Model, setSelectedTier2Model] =
    useState<string>(defaultTier2ModelId);

  const sortedScenes = useMemo(
    () => [...project.scenes].sort((a, b) => a.order - b.order),
    [project.scenes]
  );

  const currentSceneIdx = useMemo(() => {
    if (!draft) return -1;
    return sortedScenes.findIndex((s) => s.scene_id === draft.scene_id);
  }, [sortedScenes, draft]);

  const prevSceneObj =
    currentSceneIdx > 0 ? sortedScenes[currentSceneIdx - 1] : null;
  const nextSceneObj =
    currentSceneIdx >= 0 && currentSceneIdx < sortedScenes.length - 1
      ? sortedScenes[currentSceneIdx + 1]
      : null;

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
      setIsDirty(false);
      setSaveError(null);
      setConfirmCloseOpen(false);
      setStageError(null);
      setIsPlaying(false);
      setPinMode(false);
      setPinCoords({ x_pct: 50, y_pct: 50 });
      setPinNote("");
      setUploadApplyRembg(Boolean(scene.assets[0]?.apply_rembg));
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

  // Carregamento inicial quando o iframe fica pronto ou a cena muda
  useEffect(() => {
    if (!draft || !iframeReady) return;
    const initial = Math.min(1100, Math.round(durationMs * 0.35));
    setTimeMs(initial);
    sendLoadScene(draft, initial, showSafeZones);
  }, [iframeReady, draft?.scene_id, mediaRevision]); // eslint-disable-line react-hooks/exhaustive-deps

  // Preview ao vivo em tempo real sempre que o usuário alterar visual/template/assets
  const draftLiveSignature = useMemo(() => {
    if (!draft) return "";
    return JSON.stringify({
      template: draft.template,
      tier: draft.tier,
      visual: draft.visual,
      assets: draft.assets.map((a) => ({
        id: a.asset_id,
        rel: a.cache_relpath,
        rembg: a.apply_rembg,
      })),
    });
  }, [draft]);

  const lastSyncedSigRef = useRef<string>("");
  useEffect(() => {
    if (!draft || !iframeReady) return;
    if (!lastSyncedSigRef.current) {
      lastSyncedSigRef.current = draftLiveSignature;
      return;
    }
    if (lastSyncedSigRef.current === draftLiveSignature) return;
    lastSyncedSigRef.current = draftLiveSignature;

    if (liveSyncTimerRef.current !== null) {
      window.clearTimeout(liveSyncTimerRef.current);
    }
    liveSyncTimerRef.current = window.setTimeout(() => {
      sendLoadScene(draft, timeMs, showSafeZones);
    }, 85);

    return () => {
      if (liveSyncTimerRef.current !== null) {
        window.clearTimeout(liveSyncTimerRef.current);
      }
    };
  }, [draftLiveSignature, iframeReady]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      stopPlayback();
      if (liveSyncTimerRef.current !== null) {
        window.clearTimeout(liveSyncTimerRef.current);
      }
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

  const startPlaybackFrom = useCallback(
    (startOffset: number) => {
      stopPlayback();
      const clampedStart = Math.max(0, Math.min(durationMs, startOffset));
      setTimeMs(clampedStart);
      postToStage({ type: "STUDIO_SEEK", timeMs: clampedStart });
      setIsPlaying(true);

      const audioEl = audioRef.current;
      const hasSyncedAudio =
        Boolean(
          audioEl && project.artifacts.has_audio && project.artifacts.audio_url
        ) && draft?.timing.resolved_start_ms !== null;

      if (hasSyncedAudio && audioEl) {
        audioEl.currentTime = (sceneStartMs + clampedStart) / 1000;
        audioEl.play().catch((err) => {
          console.warn("[Studio Preview] Autoplay de áudio bloqueado:", err);
        });
      }

      playStartRef.current = {
        wallMs: performance.now(),
        offsetMs: clampedStart,
      };

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
    },
    [
      stopPlayback,
      durationMs,
      postToStage,
      project.artifacts.has_audio,
      project.artifacts.audio_url,
      draft?.timing.resolved_start_ms,
      sceneStartMs,
      seekTo,
    ]
  );

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      stopPlayback();
      return;
    }
    const startOffset = timeMs >= durationMs - 40 ? 0 : timeMs;
    startPlaybackFrom(startOffset);
  }, [isPlaying, stopPlayback, timeMs, durationMs, startPlaybackFrom]);

  const replayFromStart = useCallback(() => {
    if (!draft) return;
    sendLoadScene(draft, 0, showSafeZones);
    window.setTimeout(() => {
      startPlaybackFrom(0);
    }, 60);
  }, [draft, sendLoadScene, showSafeZones, startPlaybackFrom]);

  useEffect(() => {
    onRegisterTogglePlay?.(togglePlay);
    return () => onRegisterTogglePlay?.(null);
  }, [onRegisterTogglePlay, togglePlay]);

  const persistDraft = useCallback(
    async (statusOverride?: SceneStatus): Promise<SceneData | undefined> => {
      if (!draft) return undefined;
      setSaveError(null);
      const cleanVisual = buildSanitizedVisual(draft.visual);
      const saved = await onSaveScene(draft.scene_id, {
        template: draft.template,
        tier: draft.template === "tier2_video" ? 2 : 1,
        status: statusOverride ?? draft.status,
        visual: cleanVisual,
        assets: draft.assets,
      });
      if (saved) {
        setDraft(saved);
        setIsDirty(false);
        setConfirmCloseOpen(false);
        sendLoadScene(saved, timeMs, showSafeZones);
      } else {
        setSaveError(
          "Não foi possível salvar esta cena. Verifique a notificação de erro ou reinicie o servidor."
        );
      }
      return saved;
    },
    [draft, onSaveScene, sendLoadScene, timeMs, showSafeZones]
  );

  // Atalho Ctrl+S / Cmd+S dentro do editor de cena
  useEffect(() => {
    if (!scene) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        e.stopPropagation();
        void persistDraft();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [scene, persistDraft]);

  if (!scene || !draft) return null;

  const updateDraft = (updater: (prev: SceneData) => SceneData) => {
    setIsDirty(true);
    setSaveError(null);
    setConfirmCloseOpen(false);
    setDraft((prev) => (prev ? updater(prev) : prev));
  };

  const updateVisual = (patch: Partial<SceneVisual>) => {
    updateDraft((prev) => ({
      ...prev,
      visual: {
        ...prev.visual,
        ...patch,
      },
    }));
  };

  const handleRequestClose = () => {
    if (isDirty) {
      setConfirmCloseOpen(true);
      return;
    }
    onClose();
  };

  const handleNavigateWithSave = async (targetSceneId: string) => {
    stopPlayback();
    if (isDirty) {
      const saved = await persistDraft();
      if (!saved) return;
    }
    onNavigateScene?.(targetSceneId);
  };

  const primaryAsset = draft.assets[0];
  const primaryAssetUrl = primaryAsset?.cache_relpath
    ? studioApi.mediaUrl(
        project.manifest.slug,
        primaryAsset.cache_relpath,
        mediaRevision
      )
    : null;
  const promptText =
    primaryAsset?.prompt ||
    `Editorial Vox style paper collage cutout for '${draft.visual.headline}', warm parchment tones, torn edges, subtle drop shadow`;

  const headlineMeta = getFieldMeta("headline", "Headline da Cena", "MAKÁRIOS");
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
    await persistDraft();
  };

  const handleSaveAndClose = async () => {
    const saved = await persistDraft();
    if (saved) {
      onClose();
    }
  };

  const handleSaveAndRegenerate = async () => {
    if (isDirty) {
      const saved = await persistDraft();
      if (!saved) return;
    }
    await onRegenerateScene(draft.scene_id, "preview");
  };

  const handleApprove = async () => {
    await persistDraft("approved");
  };

  const handleFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    await onUploadAsset(draft.scene_id, file, {
      asset_id: primaryAsset?.asset_id,
      apply_rembg: uploadApplyRembg,
    });
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
    setActiveTab("pins_tier2");
    window.setTimeout(() => pinInputRef.current?.focus(), 40);
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
      setIsDirty(false);
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

  const imageScale = draft.visual.image_scale ?? 1.0;
  const imageOffsetX = draft.visual.image_offset_x ?? 0;
  const imageOffsetY = draft.visual.image_offset_y ?? 0;
  const imageOpacity = draft.visual.image_opacity ?? 1.0;
  const animationSpeed = draft.visual.animation_speed ?? 1.0;
  const motionIntensity = draft.visual.motion_intensity ?? 1.0;

  return (
    <div className="modal-backdrop" onClick={handleRequestClose}>
      <div
        className="modal-card preview-modal"
        data-testid="scene-preview-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Editor e Preview ao vivo ${draft.scene_id}`}
      >
        <div className="modal-header">
          <div className="modal-title">
            <span className="node-step-badge">
              {draft.scene_id.toUpperCase()}
            </span>
            <span>Editor de Cena 9:16</span>
            <span className="pill pill-blue">{draft.template}</span>
            {isDirty ? (
              <span className="pill pill-stale">não salvo</span>
            ) : (
              <span className="pill pill-ok">salvo</span>
            )}
            {sortedScenes.length > 1 && onNavigateScene && (
              <div className="scene-nav-group">
                <button
                  type="button"
                  className="btn btn-xs"
                  disabled={!prevSceneObj || busySave}
                  title="Salvar (se alterado) e ir para cena anterior"
                  onClick={() => {
                    if (prevSceneObj) {
                      void handleNavigateWithSave(prevSceneObj.scene_id);
                    }
                  }}
                >
                  <ChevronLeft size={12} />
                </button>
                <span className="mono" style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                  {currentSceneIdx + 1}/{sortedScenes.length}
                </span>
                <button
                  type="button"
                  className="btn btn-xs"
                  disabled={!nextSceneObj || busySave}
                  title="Salvar (se alterado) e ir para próxima cena"
                  onClick={() => {
                    if (nextSceneObj) {
                      void handleNavigateWithSave(nextSceneObj.scene_id);
                    }
                  }}
                >
                  <ChevronRight size={12} />
                </button>
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              className={`btn btn-sm ${isDirty ? "btn-primary btn-save-dirty" : ""}`}
              data-testid="btn-save-scene-header"
              disabled={busySave}
              onClick={() => void handleSaveAndPreview()}
              title="Salvar alterações desta cena (Ctrl+S)"
            >
              <Save size={13} />
              {busySave ? "Salvando..." : isDirty ? "Salvar Cena" : "Salvo"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={handleRequestClose}
              aria-label="Fechar preview"
            >
              <X size={16} />
            </button>
          </div>
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
                onClick={() => {
                  const next = !pinMode;
                  setPinMode(next);
                  if (next) setActiveTab("pins_tier2");
                }}
                title="Ativar modo Pin para clicar sobre o palco 9:16 e registrar nota"
              >
                <MapPin size={12} />
                Modo Pin {pinMode ? "(clique no palco)" : ""}
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
                <div style={{ display: "flex", gap: 5 }}>
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
                    onClick={replayFromStart}
                    title="Testar transição e animações desde 0ms"
                  >
                    <RotateCcw size={12} /> 0s
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
                    <SkipBack size={12} />
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
                    <SkipForward size={12} />
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
                  <span>Safe-Zones 9:16</span>
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

          {/* Direita: Inspetor Completo por Abas (Abas Fixas + Corpo Rolável + Rodapé Fixo) */}
          <div className="preview-inspector-col">
            <div className="inspector-tabs-bar">
              <div className="inspector-tabs" role="tablist" aria-label="Abas do editor de cena">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "content"}
                  className={`inspector-tab-btn ${activeTab === "content" ? "active" : ""}`}
                  data-testid="tab-scene-content"
                  onClick={() => setActiveTab("content")}
                >
                  <Type size={13} /> Conteúdo
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "media"}
                  className={`inspector-tab-btn ${activeTab === "media" ? "active" : ""}`}
                  data-testid="tab-scene-media"
                  onClick={() => setActiveTab("media")}
                >
                  <ImageIcon size={13} /> Imagem
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "animation"}
                  className={`inspector-tab-btn ${activeTab === "animation" ? "active" : ""}`}
                  data-testid="tab-scene-animation"
                  onClick={() => setActiveTab("animation")}
                >
                  <Film size={13} /> Animações
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "pins_tier2"}
                  className={`inspector-tab-btn ${activeTab === "pins_tier2" ? "active" : ""}`}
                  data-testid="tab-scene-pins-tier2"
                  onClick={() => setActiveTab("pins_tier2")}
                >
                  <Layers size={13} /> Pins & IA
                </button>
              </div>
            </div>

            <div className="inspector-scroll-area">

            {/* ================= ABA 1: CONTEÚDO & TEMPLATE ================= */}
            {activeTab === "content" && (
              <div className="inspector-tab-body">
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
                        updateDraft((prev) => ({
                          ...prev,
                          template: nextTpl,
                          tier: nextTpl === "tier2_video" ? 2 : 1,
                        }));
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
                      data-testid="select-scene-theme"
                      value={draft.visual.background_theme}
                      onChange={(e) =>
                        updateVisual({ background_theme: e.target.value })
                      }
                    >
                      <option value="pergaminho">Pergaminho (#F4EDE1)</option>
                      <option value="carvao">Carvão Noturno (#181A1F)</option>
                      <option value="azul_marinho">
                        Azul Histórico (#1E3A5F)
                      </option>
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
                        updateVisual({ headline: e.target.value })
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
                      onChange={(e) => updateVisual({ subtext: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid-2">
                  <div>
                    <label className="field-label">
                      {originalTermMeta.label}
                    </label>
                    <input
                      className="input"
                      data-testid="input-scene-original-term"
                      name="original_term"
                      placeholder={originalTermMeta.placeholder}
                      value={draft.visual.original_term || ""}
                      onChange={(e) =>
                        updateVisual({
                          original_term: e.target.value || null,
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
                        updateVisual({ stamp_text: e.target.value || null })
                      }
                    />
                  </div>
                </div>

                <div className="grid-2" style={{ alignItems: "end" }}>
                  <div>
                    <label className="field-label">Status da Cena</label>
                    <select
                      className="select mono"
                      value={draft.status}
                      onChange={(e) =>
                        updateDraft((prev) => ({
                          ...prev,
                          status: e.target.value as SceneStatus,
                        }))
                      }
                    >
                      <option value="draft">draft</option>
                      <option value="approved">approved</option>
                      <option value="needs_revision">needs_revision</option>
                      <option value="rendered">rendered</option>
                    </select>
                  </div>
                  <div>
                    <label className="field-label">Carimbo / Selo</label>
                    <select
                      className="select"
                      value={
                        draft.visual.show_stamp === true
                          ? "show"
                          : draft.visual.show_stamp === false
                            ? "hide"
                            : "auto"
                      }
                      onChange={(e) => {
                        const val = e.target.value;
                        updateVisual({
                          show_stamp:
                            val === "show"
                              ? true
                              : val === "hide"
                                ? false
                                : null,
                        });
                      }}
                    >
                      <option value="auto">Automático do Template</option>
                      <option value="show">Sempre Exibir Carimbo</option>
                      <option value="hide">Ocultar Carimbo</option>
                    </select>
                  </div>
                </div>

                <div className="refine-box">
                  <div className="field-label" style={{ marginBottom: 0 }}>
                    <span>Atalhos Rápidos</span>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setActiveTab("media")}
                    >
                      <ImagePlus size={12} color="#E5A93C" />
                      {primaryAssetUrl
                        ? "Ajustar / Trocar Imagem"
                        : "Adicionar Imagem na Cena"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setActiveTab("animation")}
                    >
                      <Film size={12} color="#7eb2ff" />
                      Trocar Transição & Animações
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ================= ABA 2: IMAGEM & MÍDIA ================= */}
            {activeTab === "media" && (
              <div className="inspector-tab-body" data-testid="panel-scene-media">
                {primaryAssetUrl && (
                  <div className="current-asset-card">
                    <img
                      src={primaryAssetUrl}
                      alt={draft.scene_id}
                      className="current-asset-thumb"
                    />
                    <div className="current-asset-meta">
                      <strong style={{ fontSize: 12 }}>Imagem Anexada</strong>
                      <span
                        className="mono truncate"
                        style={{ fontSize: 10.5, color: "var(--text-secondary)" }}
                        title={primaryAsset?.cache_relpath || ""}
                      >
                        {primaryAsset?.cache_relpath}
                      </span>
                    </div>
                    {onDeleteAsset && (
                      <button
                        type="button"
                        className="btn btn-danger btn-xs"
                        data-testid="btn-delete-scene-asset"
                        disabled={busyAsset}
                        onClick={() =>
                          void onDeleteAsset(
                            draft.scene_id,
                            primaryAsset?.asset_id
                          )
                        }
                        title="Remover imagem desta cena"
                      >
                        <Trash2 size={12} /> Remover
                      </button>
                    )}
                  </div>
                )}

                <div className="refine-box">
                  <div className="field-label" style={{ marginBottom: 2 }}>
                    <span>Enviar ou Trocar Imagem (PNG, JPG, WEBP)</span>
                    <label
                      className="scripture-check"
                      style={{ fontSize: 11, fontWeight: 500 }}
                    >
                      <input
                        type="checkbox"
                        checked={uploadApplyRembg}
                        onChange={(e) => setUploadApplyRembg(e.target.checked)}
                      />
                      <span>Remover fundo (recorte PNG)</span>
                    </label>
                  </div>

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
                        : primaryAssetUrl
                          ? "Arraste ou clique para substituir a imagem atual"
                          : "Arraste aqui ou clique para escolher uma imagem"}
                    </div>
                  </div>
                </div>

                {/* Controles de Exibição & Enquadramento */}
                <div className="grid-2">
                  <div>
                    <label className="field-label">Modo de Exibição na Cena</label>
                    <select
                      className="select"
                      data-testid="select-image-layout"
                      value={draft.visual.image_layout || "auto"}
                      onChange={(e) =>
                        updateVisual({
                          image_layout: e.target.value as ImageLayoutMode,
                        })
                      }
                    >
                      {IMAGE_LAYOUT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="field-label">Ajuste / Enquadramento</label>
                    <select
                      className="select"
                      data-testid="select-image-fit"
                      value={draft.visual.image_fit || "cover"}
                      onChange={(e) =>
                        updateVisual({
                          image_fit: e.target.value as ImageFitMode,
                        })
                      }
                    >
                      <option value="cover">Preencher moldura (cover)</option>
                      <option value="contain">
                        Mostrar inteira sem corte (contain)
                      </option>
                    </select>
                  </div>
                </div>

                <div className="refine-box">
                  <div className="field-label" style={{ marginBottom: 2 }}>
                    <span>Enquadramento & Opacidade (Ao Vivo)</span>
                    <button
                      type="button"
                      className="btn btn-xs"
                      onClick={() =>
                        updateVisual({
                          image_scale: 1.0,
                          image_offset_x: 0,
                          image_offset_y: 0,
                          image_opacity: 1.0,
                        })
                      }
                    >
                      <RotateCcw size={10} /> Resetar
                    </button>
                  </div>

                  <div className="grid-2">
                    <div className="slider-field">
                      <div className="slider-head">
                        <span>Zoom da Imagem</span>
                        <strong>{Math.round(imageScale * 100)}%</strong>
                      </div>
                      <input
                        type="range"
                        className="studio-range"
                        min={0.4}
                        max={2.4}
                        step={0.05}
                        value={imageScale}
                        onChange={(e) =>
                          updateVisual({ image_scale: Number(e.target.value) })
                        }
                      />
                    </div>
                    <div className="slider-field">
                      <div className="slider-head">
                        <span>Opacidade</span>
                        <strong>{Math.round(imageOpacity * 100)}%</strong>
                      </div>
                      <input
                        type="range"
                        className="studio-range"
                        min={0.1}
                        max={1.0}
                        step={0.05}
                        value={imageOpacity}
                        onChange={(e) =>
                          updateVisual({
                            image_opacity: Number(e.target.value),
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className="grid-2">
                    <div className="slider-field">
                      <div className="slider-head">
                        <span>Posição Horizontal (X)</span>
                        <strong>{Math.round(imageOffsetX)}%</strong>
                      </div>
                      <input
                        type="range"
                        className="studio-range"
                        min={-50}
                        max={50}
                        step={1}
                        value={imageOffsetX}
                        onChange={(e) =>
                          updateVisual({
                            image_offset_x: Number(e.target.value),
                          })
                        }
                      />
                    </div>
                    <div className="slider-field">
                      <div className="slider-head">
                        <span>Posição Vertical (Y)</span>
                        <strong>{Math.round(imageOffsetY)}%</strong>
                      </div>
                      <input
                        type="range"
                        className="studio-range"
                        min={-50}
                        max={50}
                        step={1}
                        value={imageOffsetY}
                        onChange={(e) =>
                          updateVisual({
                            image_offset_y: Number(e.target.value),
                          })
                        }
                      />
                    </div>
                  </div>
                </div>

                {/* Ilustração SVG Editorial (quando sem foto) */}
                <div>
                  <label className="field-label">
                    Ilustração SVG Editorial (quando sem foto ou modo SVG)
                  </label>
                  <select
                    className="select"
                    data-testid="select-illustration-variant"
                    value={draft.visual.illustration_variant || "auto"}
                    onChange={(e) =>
                      updateVisual({
                        illustration_variant: e.target
                          .value as IllustrationVariant,
                      })
                    }
                  >
                    {ILLUSTRATION_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Biblioteca de Imagens já enviadas no projeto */}
                {projectAssets.length > 0 && onAttachAsset && (
                  <div className="refine-box">
                    <div className="field-label" style={{ marginBottom: 2 }}>
                      <span>
                        Biblioteca do Projeto ({projectAssets.length}) · Clique
                        para aplicar
                      </span>
                    </div>
                    <div className="asset-library-grid">
                      {projectAssets.map((item) => {
                        const isActive =
                          primaryAsset?.cache_relpath === item.cache_relpath;
                        return (
                          <button
                            key={item.cache_relpath}
                            type="button"
                            className={`asset-lib-item ${isActive ? "active" : ""}`}
                            disabled={busyAsset}
                            title={`Aplicar ${item.filename} nesta cena`}
                            onClick={() =>
                              void onAttachAsset(draft.scene_id, {
                                cache_relpath: item.cache_relpath,
                                asset_id: primaryAsset?.asset_id,
                                apply_rembg: uploadApplyRembg,
                              })
                            }
                          >
                            <img
                              src={`${item.url}?v=${mediaRevision}`}
                              alt={item.filename}
                            />
                            <span className="asset-lib-name">
                              {item.filename}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Prompt Pack Gemini PRO */}
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
                    style={{ fontSize: 11.5, minHeight: 58 }}
                    value={promptText}
                    onChange={(e) => {
                      const nextPrompt = e.target.value;
                      updateDraft((prev) => {
                        const nextAssets =
                          prev.assets.length > 0
                            ? prev.assets.map((a, i) =>
                                i === 0 ? { ...a, prompt: nextPrompt } : a
                              )
                            : [
                                {
                                  asset_id: `img_${prev.scene_id}`,
                                  provider: "gemini_hybrid",
                                  prompt: nextPrompt,
                                  apply_rembg: uploadApplyRembg,
                                  cache_relpath: null,
                                  sha256: null,
                                },
                              ];
                        return { ...prev, assets: nextAssets };
                      });
                    }}
                  />
                </div>
              </div>
            )}

            {/* ================= ABA 3: ANIMAÇÕES & MOVIMENTO ================= */}
            {activeTab === "animation" && (
              <div
                className="inspector-tab-body"
                data-testid="panel-scene-animation"
              >
                <div className="refine-box">
                  <div className="field-label" style={{ marginBottom: 2 }}>
                    <span>Presets de Animação (1 Clique)</span>
                    <button
                      type="button"
                      className="btn btn-primary btn-xs"
                      onClick={replayFromStart}
                    >
                      <RotateCcw size={11} /> Testar do Início (0ms)
                    </button>
                  </div>
                  <div className="motion-presets-grid">
                    {MOTION_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        className="motion-preset-btn"
                        data-testid={`btn-motion-preset-${preset.id}`}
                        onClick={() => {
                          updateVisual(preset.patch);
                          window.setTimeout(replayFromStart, 110);
                        }}
                      >
                        <span>{preset.label}</span>
                        <span className="motion-preset-sub">{preset.sub}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid-2">
                  <div>
                    <label className="field-label">Transição de Entrada</label>
                    <select
                      className="select"
                      data-testid="select-scene-transition"
                      value={draft.visual.transition_in}
                      onChange={(e) =>
                        updateVisual({ transition_in: e.target.value })
                      }
                    >
                      {TRANSITION_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="field-label">
                      Movimento Contínuo de Câmera
                    </label>
                    <select
                      className="select"
                      data-testid="select-camera-motion"
                      value={normalizeCameraMotionValue(
                        draft.visual.camera_motion
                      )}
                      onChange={(e) =>
                        updateVisual({
                          camera_motion: e.target.value as CameraMotionMode,
                        })
                      }
                    >
                      {CAMERA_MOTION_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid-2">
                  <div>
                    <label className="field-label">Animação da Imagem</label>
                    <select
                      className="select"
                      data-testid="select-image-animation"
                      value={draft.visual.image_animation || "ken_burns_in"}
                      onChange={(e) =>
                        updateVisual({
                          image_animation: e.target.value as ImageAnimationMode,
                        })
                      }
                    >
                      {IMAGE_ANIMATION_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="field-label">
                      Estilo de Entrada dos Elementos
                    </label>
                    <select
                      className="select"
                      data-testid="select-element-animation"
                      value={draft.visual.element_animation || "vox_editorial"}
                      onChange={(e) =>
                        updateVisual({
                          element_animation: e.target
                            .value as ElementAnimationMode,
                        })
                      }
                    >
                      {ELEMENT_ANIMATION_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="refine-box">
                  <div className="field-label" style={{ marginBottom: 2 }}>
                    <span>Calibração Fina (Determinística no Render MP4)</span>
                    <button
                      type="button"
                      className="btn btn-xs"
                      onClick={() =>
                        updateVisual({
                          animation_speed: 1.0,
                          motion_intensity: 1.0,
                        })
                      }
                    >
                      <RotateCcw size={10} /> Padrão 1.0x
                    </button>
                  </div>

                  <div className="grid-2">
                    <div className="slider-field">
                      <div className="slider-head">
                        <span>Velocidade das Animações</span>
                        <strong>{animationSpeed.toFixed(2)}x</strong>
                      </div>
                      <input
                        type="range"
                        className="studio-range"
                        data-testid="slider-animation-speed"
                        min={0.4}
                        max={2.4}
                        step={0.05}
                        value={animationSpeed}
                        onChange={(e) =>
                          updateVisual({
                            animation_speed: Number(e.target.value),
                          })
                        }
                      />
                    </div>
                    <div className="slider-field">
                      <div className="slider-head">
                        <span>Intensidade do Movimento</span>
                        <strong>{Math.round(motionIntensity * 100)}%</strong>
                      </div>
                      <input
                        type="range"
                        className="studio-range"
                        data-testid="slider-motion-intensity"
                        min={0.0}
                        max={2.0}
                        step={0.05}
                        value={motionIntensity}
                        onChange={(e) =>
                          updateVisual({
                            motion_intensity: Number(e.target.value),
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ================= ABA 4: PINS DE REVISÃO & NÍVEL 2 ================= */}
            {activeTab === "pins_tier2" && (
              <div className="inspector-tab-body">
                <div className="refine-box" data-testid="inspector-pins-section">
                  <div className="field-label" style={{ marginBottom: 2 }}>
                    <span>
                      📍 Pins de Revisão ({reviewPins.length}) ·{" "}
                      <span className="mono" style={{ color: "var(--vox-gold)" }}>
                        {pinCoords.x_pct.toFixed(0)}%,{" "}
                        {pinCoords.y_pct.toFixed(0)}% @{" "}
                        {(timeMs / 1000).toFixed(1)}s
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
                                ({pin.x_pct.toFixed(0)}%,{" "}
                                {pin.y_pct.toFixed(0)}%)
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

                <div
                  className="refine-box tier2-box"
                  data-testid="tier2-inspector-box"
                >
                  <div className="field-label" style={{ marginBottom: 2 }}>
                    <span>
                      <Sparkles size={11} color="#E5A93C" /> Nível 2 Cirúrgico &
                      3D (Sob Teto USD)
                    </span>
                    <span className="pill">
                      Teto Cena: $
                      {tier2Catalog.max_cost_per_scene_usd.toFixed(2)} · Vídeo:
                      ${spentTotal.toFixed(2)}/${videoCap.toFixed(2)}
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
                          tier2Catalog.enable_tier2_video
                            ? "pill-ok"
                            : "pill-alert"
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
                        Fal 3D:{" "}
                        {tier2Catalog.enable_fal_3d ? "ON" : "OFF (.env)"}
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
                    >
                      Gerar via API Paga ($
                      {(selectedModelInfo?.cost_usd ?? 0.19).toFixed(2)})
                    </button>
                  </div>
                </div>
              </div>
            )}

            </div>

            {/* Rodapé SEMPRE FIXO e VISÍVEL (fora da área de scroll) */}
            <div className="inspector-footer-sticky">
              {confirmCloseOpen && isDirty && (
                <div className="unsaved-close-bar" data-testid="unsaved-close-bar">
                  <span>Existem alterações não salvas nesta cena.</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-xs"
                      disabled={busySave}
                      onClick={() => void handleSaveAndClose()}
                    >
                      <Save size={11} /> Salvar e Fechar
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-xs"
                      onClick={onClose}
                    >
                      Descartar
                    </button>
                    <button
                      type="button"
                      className="btn btn-xs"
                      onClick={() => setConfirmCloseOpen(false)}
                    >
                      Continuar
                    </button>
                  </div>
                </div>
              )}

              <div className="save-status-line mono">
                {saveError ? (
                  <span className="save-status-error">{saveError}</span>
                ) : (
                  <span>
                    Âncora word_id: {draft.timing.start_word_id} →{" "}
                    {draft.timing.end_word_id}
                    {draft.cache_hash
                      ? ` · hash ${draft.cache_hash.slice(0, 10)}`
                      : ""}
                  </span>
                )}
                <span>Ctrl+S para salvar</span>
              </div>

              <div className="inspector-actions">
                <button
                  type="button"
                  className={`btn btn-primary ${isDirty ? "btn-save-dirty" : ""}`}
                  data-testid="btn-save-scene-preview"
                  disabled={busySave}
                  onClick={() => void handleSaveAndPreview()}
                >
                  <Save size={13} />
                  {busySave
                    ? "Salvando..."
                    : isDirty
                      ? "Salvar Alterações"
                      : "Tudo Salvo"}
                </button>

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-blue"
                    disabled={busyRegen || busySave}
                    onClick={() => void handleSaveAndRegenerate()}
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
    </div>
  );
}
