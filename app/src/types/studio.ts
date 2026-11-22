// app/src/types/studio.ts

export type FormatType =
  | "mapa_contexto"
  | "perdido_traducao"
  | "mito_vs_texto"
  | "conexao_at_nt";

export type AudioMode =
  | "recorded"
  | "pilot_sapi"
  | "xtts_v2"
  | "f5_tts"
  | "voicestudio";
export type TtsEngineId = "pilot_sapi" | "xtts_v2" | "f5_tts" | "voicestudio";
export type HumanSealMode = "none" | "paper_cutout" | "real_clip_3s";
export type BibleTranslation = "NVI" | "ARA" | "NAA";

export type SceneStatus =
  | "draft"
  | "approved"
  | "needs_revision"
  | "rendered"
  | "discarded";

export type SceneTemplate =
  | "paper_collage"
  | "bible_quote_card"
  | "kinetic_captions"
  | "timeline_map"
  | "tier2_video";

export type TransitionIn = "cut" | "paper_tear" | "whip_pan" | "stamp_drop";
export type BackgroundTheme = "pergaminho" | "carvao" | "azul_marinho";

export interface ProjectGates {
  briefing_approved: boolean;
  scripture_verified: boolean;
  script_gate_1_approved: boolean;
  audio_aligned: boolean;
  scenes_approved: boolean;
  qa_passed: boolean;
}

export interface CostLedgerItem {
  item_id?: string;
  stage?: string;
  provider?: string;
  cost_usd: number;
  note?: string;
}

export interface CostLedger {
  currency: string;
  estimated_total: number;
  spent_total: number;
  cap_usd: number;
  items: CostLedgerItem[];
}

export interface SeriesInfo {
  series_id: string;
  format_type: FormatType;
  episode_number: number;
  batch_id: string | null;
}

export interface Metrics48h {
  published_at: string | null;
  viewed_vs_swiped_pct: number | null;
  avg_retention_pct: number | null;
  comments_count: number | null;
}

export interface Manifest {
  schema_version: string;
  slug: string;
  title: string;
  created_at: string;
  updated_at: string;
  preset_id: string;
  series: SeriesInfo;
  gates: ProjectGates;
  cost_ledger: CostLedger;
  metrics_48h?: Metrics48h;
}

export interface RecommendedFormat {
  format_type: FormatType;
  confidence: number;
  rationale: string;
}

export interface Briefing {
  raw_idea: string;
  seed_reference: string | null;
  bible_translation: string;
  target_duration_sec: number;
  audio_mode: AudioMode;
  human_seal_mode: HumanSealMode;
  recommended_format: RecommendedFormat | null;
  selected_format_type: FormatType;
  optional_reference_layout: string | null;
}

export interface ScriptHook {
  id: string;
  hook_type: string;
  spoken_text: string;
  visual_interrupt: string;
}

export interface NarrationSegment {
  segment_id: string;
  role: string;
  display_text: string;
  tts_text: string;
}

export interface ScriptureRef {
  ref_id: string;
  citation: string;
  translation: string;
  exact_text: string;
  verified_by_human: boolean;
}

export interface CoverSpec {
  headline: string;
  subheadline: string;
  highlight_word: string;
}

export interface DistributionPack {
  shorts_title: string;
  caption_reels_tiktok: string;
  hashtags: string[];
  pinned_comment: string;
  cover_spec: CoverSpec;
}

export interface ScriptData {
  selected_hook_id: string;
  hooks: ScriptHook[];
  narration_segments: NarrationSegment[];
  scripture_refs: ScriptureRef[];
  distribution_pack: DistributionPack;
}

export interface AlignedWord {
  word_id: string;
  segment_id: string;
  text: string;
  start_ms: number;
  end_ms: number;
  confidence: number;
}

export interface AudioAlignment {
  audio_source: string;
  audio_cache_relpath: string;
  audio_sha256: string;
  sample_rate_hz: number;
  duration_ms: number;
  alignment_engine: string;
  words: AlignedWord[];
}

export interface Storyboard {
  fps: number;
  width: number;
  height: number;
  music_track: string | null;
  music_enabled: boolean;
  captions_enabled: boolean;
  scene_ids: string[];
}

export interface SceneTiming {
  start_word_id: string;
  end_word_id: string;
  resolved_start_ms: number | null;
  resolved_end_ms: number | null;
}

export interface SceneVisual {
  background_theme: string;
  headline: string;
  subtext: string | null;
  highlight_word_ids: string[];
  transition_in: TransitionIn | string;
  camera_motion: string;
  reference_layout_asset?: string | null;
  scripture_ref_id?: string | null;
  original_term?: string | null;
  stamp_text?: string | null;
  series_label?: string | null;
}

export interface SceneAsset {
  asset_id: string;
  provider: string;
  prompt: string;
  apply_rembg: boolean;
  cache_relpath: string | null;
  sha256: string | null;
}

export interface SfxCue {
  sfx_id: string;
  anchor_word_id: string;
  offset_ms: number;
  gain_db: number;
}

export interface ReviewPin {
  pin_id: string;
  x_pct: number;
  y_pct: number;
  time_ms: number;
  note: string;
  resolved: boolean;
}

export interface SceneData {
  scene_id: string;
  order: number;
  status: SceneStatus;
  tier: 1 | 2;
  template: SceneTemplate | string;
  template_version: string;
  timing: SceneTiming;
  visual: SceneVisual;
  assets: SceneAsset[];
  sfx_cues: SfxCue[];
  review_pins: ReviewPin[];
  cache_hash: string | null;
  cost_usd: number;
}

export interface FormatSeriesPreset {
  format_type: FormatType;
  label: string;
  description: string;
  default_templates: string[];
  hook_types: string[];
}

export interface StylePreset {
  preset_id: string;
  name: string;
  channel_url: string;
  channel_handle: string;
  default_bible_translation: string;
  video: {
    aspect_ratio: string;
    width: number;
    height: number;
    fps: number;
    preview_width: number;
    preview_height: number;
    preview_fps: number;
    target_duration_sec: { min: number; ideal: number; max: number };
    scene_pacing_sec: { min: number; max: number };
  };
  safe_zones_px: { top: number; bottom: number; right: number; left: number };
  palette: Record<string, string>;
  typography: Record<string, string | number>;
  formats_series: FormatSeriesPreset[];
  cost_guardrails: {
    default_tier: number;
    default_image_provider: string;
    tier2_video_enabled_by_default: boolean;
    fal_3d_enabled_by_default: boolean;
    max_cost_per_scene_usd: number;
    max_cost_per_video_usd: number;
  };
}

export interface ProjectArtifacts {
  has_final_mp4: boolean;
  final_mp4_url: string | null;
  has_preview_mp4: boolean;
  preview_mp4_url: string | null;
  has_contact_sheet: boolean;
  contact_sheet_url: string | null;
  has_audio: boolean;
  audio_url: string | null;
  has_cover: boolean;
  cover_url: string | null;
}

export interface PipelineStatus {
  audio_stale: boolean;
  stale_scene_ids: string[];
  render_stale: boolean;
  pending_count: number;
}

export interface SceneRuntimeInfo {
  is_stale: boolean;
  expected_hash: string | null;
  has_clip: boolean;
  thumbnail_url: string | null;
}

export interface RunPendingResponse {
  job_id: string | null;
  status: "started" | "noop";
  pending_count: number;
  stale_scene_ids?: string[];
  message?: string;
}

export interface CloneWorkflowPayload {
  title: string;
  raw_idea: string;
  seed_reference?: string | null;
  bible_translation?: string | null;
}

export interface ProjectDetail {
  manifest: Manifest;
  briefing: Briefing;
  script: ScriptData | null;
  audio_alignment: AudioAlignment | null;
  storyboard: Storyboard | null;
  scenes: SceneData[];
  preset: StylePreset;
  artifacts: ProjectArtifacts;
  pipeline_status?: PipelineStatus;
  scene_runtime?: Record<string, SceneRuntimeInfo>;
}

export interface ProjectSummary {
  slug: string;
  title: string;
  updated_at: string;
  format_type: FormatType | string;
  gates: ProjectGates;
  scene_count: number;
  has_final_mp4: boolean;
  cost_spent_usd: number;
}

export interface HealthResponse {
  status: string;
  cache_dir: string;
  default_preset: string;
}

export interface SseProgressEvent {
  eventType: "progress" | "done" | "error" | "heartbeat";
  stage?: string;
  scene_id?: string | null;
  progress_pct?: number;
  message?: string;
  done?: boolean;
  error?: string;
  job_id?: string;
  profile?: string;
  ts?: string;
}

export interface ToastNotice {
  id: string;
  tone: "info" | "success" | "warning" | "error";
  message: string;
}

export interface TtsEngineInfo {
  id: TtsEngineId;
  label: string;
  ready: boolean;
  requires_sample: boolean;
  mode: string;
  hint: string;
}

export interface AlignmentEngineInfo {
  id: string;
  ready: boolean;
}

export interface VoiceSampleInfo {
  id: string;
  filename: string;
  duration_sec: number;
  sample_rate_hz: number;
  is_default: boolean;
  warning: string | null;
  audio_url: string;
}

export interface AudioCapabilities {
  hardware: "cpu" | "cuda";
  gpu_name: string | null;
  cpu_warning: string | null;
  tts_venv_configured: boolean;
  tts_venv_valid: boolean;
  setup_command: string;
  engines: TtsEngineInfo[];
  alignment_engines: AlignmentEngineInfo[];
  voice_samples: VoiceSampleInfo[];
}

export interface TtsPreviewChunk {
  segment_id: string;
  role: string;
  original_text: string;
  normalized_text: string;
  char_count: number;
}

export interface TtsPreviewResponse {
  total_segments: number;
  total_chunks: number;
  total_chars: number;
  estimated_duration_sec: number;
  chunks: TtsPreviewChunk[];
}

export interface GenerateTtsPayload {
  engine: TtsEngineId;
  voice_sample_id?: string | null;
  auto_align?: boolean;
}

export interface GenerateTtsResponse {
  job_id: string;
  status: string;
  engine: TtsEngineId | string;
  auto_align: boolean;
}

// ================= FASE 4: ESCALA CONTROLADA, TEMPLATES, FILA, TIER 2 & MÉTRICAS =================

export interface TemplateEditableField {
  key: "headline" | "subtext" | "original_term" | "stamp_text" | string;
  label: string;
  type: string;
  placeholder?: string;
}

export interface TemplateManifestItem {
  id: SceneTemplate | string;
  label: string;
  tier: 1 | 2;
  default_cost_usd: number;
  description: string;
  recommended_formats: string[];
  editable_fields: TemplateEditableField[];
}

export type QueueActionType =
  | "run_pending"
  | "render_preview"
  | "render_final";

export type QueueJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface QueueJobItem {
  job_id: string;
  slug: string;
  title: string;
  action: QueueActionType;
  profile: "preview" | "final";
  status: QueueJobStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  message: string | null;
  error: string | null;
}

export interface QueueStatusResponse {
  active_job_id: string | null;
  jobs: QueueJobItem[];
}

export interface Tier2ModelInfo {
  id?: string;
  model_id?: string;
  provider: "openrouter" | "fal" | string;
  kind: "video" | "image" | "3d" | string;
  cost_usd: number;
  label: string;
  description?: string;
}

export interface Tier2CatalogResponse {
  models: Tier2ModelInfo[];
  enable_tier2_video: boolean;
  enable_fal_3d: boolean;
  max_cost_per_scene_usd: number;
  max_cost_per_video_usd: number;
}

export interface Tier2GenerateResponse {
  scene: SceneData;
  cost_ledger: CostLedger;
  asset_url: string;
  simulated: boolean;
}

export interface SeriesAnalyticsItem {
  format_type: FormatType | string;
  label?: string;
  total_episodes: number;
  published_episodes: number;
  avg_viewed_vs_swiped_pct: number | null;
  avg_retention_pct: number | null;
  total_comments: number;
}

export interface SeriesAnalyticsSummary {
  series: SeriesAnalyticsItem[];
  top_performing_format: string | null;
  recommendation_note: string;
}

