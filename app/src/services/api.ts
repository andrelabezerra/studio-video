// app/src/services/api.ts
import type {
  AudioCapabilities,
  Briefing,
  CloneWorkflowPayload,
  GenerateTtsPayload,
  GenerateTtsResponse,
  HealthResponse,
  Manifest,
  Metrics48h,
  ProjectAssetLibraryItem,
  ProjectDetail,
  ProjectSummary,
  QueueActionType,
  QueueJobItem,
  QueueStatusResponse,
  RecommendedFormat,
  ReviewPin,
  RunPendingResponse,
  SceneData,
  ScriptData,
  SeriesAnalyticsSummary,
  SseProgressEvent,
  StylePreset,
  TemplateManifestItem,
  Tier2CatalogResponse,
  Tier2GenerateResponse,
  TtsPreviewResponse,
  VoiceSampleInfo,
} from "../types/studio";

export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail || `Erro HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

async function parseErrorDetail(res: Response): Promise<string> {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = (await res.json()) as {
      detail?: string | Array<{ msg?: string; loc?: unknown[] }>;
      message?: string;
    };
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) {
      return body.detail
        .map((item) => item.msg || JSON.stringify(item))
        .join("; ");
    }
    if (typeof body.message === "string") return body.message;
  }
  const text = await res.text();
  return text.trim() || `Falha HTTP ${res.status} (${res.statusText})`;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const detail = await parseErrorDetail(res);
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

export const studioApi = {
  getHealth(): Promise<HealthResponse> {
    return requestJson<HealthResponse>("/api/health");
  },

  getPresets(): Promise<{ presets: StylePreset[] }> {
    return requestJson<{ presets: StylePreset[] }>("/api/presets");
  },

  listProjects(): Promise<{ projects: ProjectSummary[] }> {
    return requestJson<{ projects: ProjectSummary[] }>("/api/projects");
  },

  createProject(payload: {
    title: string;
    raw_idea: string;
    seed_reference?: string;
    bible_translation?: string;
  }): Promise<ProjectDetail> {
    return requestJson<ProjectDetail>("/api/projects", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getProject(slug: string): Promise<ProjectDetail> {
    return requestJson<ProjectDetail>(`/api/projects/${encodeURIComponent(slug)}`);
  },

  recommendBriefing(
    slug: string,
    payload: { raw_idea: string; seed_reference?: string | null }
  ): Promise<{ recommended_format: RecommendedFormat; briefing: Briefing }> {
    return requestJson<{ recommended_format: RecommendedFormat; briefing: Briefing }>(
      `/api/projects/${encodeURIComponent(slug)}/briefing/recommend`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
  },

  updateBriefing(
    slug: string,
    briefing: Briefing
  ): Promise<ProjectDetail | { briefing: Briefing } | Briefing> {
    return requestJson(`/api/projects/${encodeURIComponent(slug)}/briefing`, {
      method: "PUT",
      body: JSON.stringify(briefing),
    });
  },

  generateScript(
    slug: string,
    options?: { use_llm?: boolean }
  ): Promise<ProjectDetail | { script: ScriptData; mode?: string }> {
    return requestJson(`/api/projects/${encodeURIComponent(slug)}/script/generate`, {
      method: "POST",
      body: JSON.stringify(options || {}),
    });
  },

  refineScript(
    slug: string,
    payload: { instruction: string; target: "hooks" | "segments" | "distribution" }
  ): Promise<{ script: ScriptData; mode: "llm" | "local" }> {
    return requestJson(`/api/projects/${encodeURIComponent(slug)}/script/refine`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  updateScript(
    slug: string,
    script: ScriptData
  ): Promise<ProjectDetail | { script: ScriptData } | ScriptData> {
    return requestJson(`/api/projects/${encodeURIComponent(slug)}/script`, {
      method: "PUT",
      body: JSON.stringify(script),
    });
  },

  approveScriptGate1(slug: string): Promise<ProjectDetail> {
    return requestJson<ProjectDetail>(
      `/api/projects/${encodeURIComponent(slug)}/script/approve`,
      { method: "POST" }
    );
  },

  uploadAudio(
    slug: string,
    file: File
  ): Promise<{ audio_url: string; duration_ms: number }> {
    const form = new FormData();
    form.append("file", file);
    return requestJson(`/api/projects/${encodeURIComponent(slug)}/audio/upload`, {
      method: "POST",
      body: form,
    });
  },

  alignAudio(
    slug: string,
    audioSource?: "recorded" | "pilot"
  ): Promise<ProjectDetail> {
    return requestJson<ProjectDetail>(
      `/api/projects/${encodeURIComponent(slug)}/audio/align`,
      {
        method: "POST",
        body: JSON.stringify(audioSource ? { audio_source: audioSource } : {}),
      }
    );
  },

  getAudioCapabilities(): Promise<AudioCapabilities> {
    return requestJson<AudioCapabilities>("/api/audio/capabilities");
  },

  listVoiceSamples(): Promise<{ samples: VoiceSampleInfo[] }> {
    return requestJson<{ samples: VoiceSampleInfo[] }>("/api/voice-samples");
  },

  uploadVoiceSample(
    file: File,
    name?: string
  ): Promise<{ sample: VoiceSampleInfo }> {
    const form = new FormData();
    form.append("file", file);
    if (name && name.trim()) {
      form.append("name", name.trim());
    }
    return requestJson<{ sample: VoiceSampleInfo }>("/api/voice-samples/upload", {
      method: "POST",
      body: form,
    });
  },

  deleteVoiceSample(
    sampleId: string
  ): Promise<{ deleted: boolean; id: string }> {
    return requestJson<{ deleted: boolean; id: string }>(
      `/api/voice-samples/${encodeURIComponent(sampleId)}`,
      { method: "DELETE" }
    );
  },

  previewTtsText(slug: string): Promise<TtsPreviewResponse> {
    return requestJson<TtsPreviewResponse>(
      `/api/projects/${encodeURIComponent(slug)}/audio/preview-tts`,
      { method: "POST" }
    );
  },

  generateTtsAudio(
    slug: string,
    payload: GenerateTtsPayload
  ): Promise<GenerateTtsResponse> {
    return requestJson<GenerateTtsResponse>(
      `/api/projects/${encodeURIComponent(slug)}/audio/generate-tts`,
      {
        method: "POST",
        body: JSON.stringify({
          engine: payload.engine,
          voice_sample_id: payload.voice_sample_id ?? null,
          auto_align: payload.auto_align ?? true,
          auto_setup: payload.auto_setup ?? true,
        }),
      }
    );
  },

  updateScene(
    slug: string,
    sceneId: string,
    payload: Partial<SceneData>
  ): Promise<{ scene: SceneData } | SceneData> {
    return requestJson(
      `/api/projects/${encodeURIComponent(slug)}/scenes/${encodeURIComponent(sceneId)}`,
      {
        method: "PUT",
        body: JSON.stringify(payload),
      }
    );
  },

  uploadSceneAsset(
    slug: string,
    sceneId: string,
    file: File,
    options?: { asset_id?: string; apply_rembg?: boolean }
  ): Promise<{ scene: SceneData; asset_url: string }> {
    const form = new FormData();
    form.append("file", file);
    if (options?.asset_id) form.append("asset_id", options.asset_id);
    if (typeof options?.apply_rembg === "boolean") {
      form.append("apply_rembg", String(options.apply_rembg));
    }
    return requestJson(
      `/api/projects/${encodeURIComponent(slug)}/scenes/${encodeURIComponent(sceneId)}/asset`,
      {
        method: "POST",
        body: form,
      }
    );
  },

  listProjectAssets(slug: string): Promise<{ assets: ProjectAssetLibraryItem[] }> {
    return requestJson<{ assets: ProjectAssetLibraryItem[] }>(
      `/api/projects/${encodeURIComponent(slug)}/assets`
    );
  },

  attachSceneAsset(
    slug: string,
    sceneId: string,
    payload: { cache_relpath: string; asset_id?: string; apply_rembg?: boolean }
  ): Promise<{ scene: SceneData; asset_url: string }> {
    return requestJson(
      `/api/projects/${encodeURIComponent(slug)}/scenes/${encodeURIComponent(sceneId)}/asset/attach`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
  },

  deleteSceneAsset(
    slug: string,
    sceneId: string,
    assetId?: string
  ): Promise<{ scene: SceneData }> {
    const query = assetId ? `?asset_id=${encodeURIComponent(assetId)}` : "";
    return requestJson(
      `/api/projects/${encodeURIComponent(slug)}/scenes/${encodeURIComponent(sceneId)}/asset${query}`,
      {
        method: "DELETE",
      }
    );
  },

  regenerateScene(
    slug: string,
    sceneId: string,
    payload?: { profile?: "preview" | "final"; force?: boolean }
  ): Promise<{ scene: SceneData; clip_url: string; cache_hit: boolean }> {
    return requestJson(
      `/api/projects/${encodeURIComponent(slug)}/scenes/${encodeURIComponent(sceneId)}/regenerate`,
      {
        method: "POST",
        body: JSON.stringify({
          profile: payload?.profile || "preview",
          force: payload?.force ?? true,
        }),
      }
    );
  },

  startRender(
    slug: string,
    payload: { profile: "preview" | "final"; force?: boolean }
  ): Promise<{ job_id: string; status: string }> {
    return requestJson(`/api/projects/${encodeURIComponent(slug)}/render`, {
      method: "POST",
      body: JSON.stringify({
        profile: payload.profile,
        force: payload.force ?? false,
      }),
    });
  },

  generateCover(slug: string): Promise<{ cover_url: string }> {
    return requestJson<{ cover_url: string }>(
      `/api/projects/${encodeURIComponent(slug)}/cover`,
      { method: "POST" }
    );
  },

  runPending(
    slug: string,
    payload?: { profile?: "preview" | "final" }
  ): Promise<RunPendingResponse> {
    return requestJson<RunPendingResponse>(
      `/api/projects/${encodeURIComponent(slug)}/run-pending`,
      {
        method: "POST",
        body: JSON.stringify({ profile: payload?.profile || "preview" }),
      }
    );
  },

  cloneWorkflow(
    slug: string,
    payload: CloneWorkflowPayload
  ): Promise<ProjectDetail> {
    return requestJson<ProjectDetail>(
      `/api/projects/${encodeURIComponent(slug)}/clone-workflow`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
  },

  // ---- FASE 4: Manifesto de Templates, Fila, Pins, Nível 2 & Métricas 48h ----

  getTemplates(): Promise<{ templates: TemplateManifestItem[] }> {
    return requestJson<{ templates: TemplateManifestItem[] }>("/api/templates");
  },

  getQueue(): Promise<QueueStatusResponse> {
    return requestJson<QueueStatusResponse>("/api/queue");
  },

  enqueueJob(payload: {
    slug: string;
    action?: QueueActionType;
    profile?: "preview" | "final";
  }): Promise<{ job: QueueJobItem; queue_length: number }> {
    return requestJson<{ job: QueueJobItem; queue_length: number }>(
      "/api/queue/enqueue",
      {
        method: "POST",
        body: JSON.stringify({
          slug: payload.slug,
          action: payload.action || "run_pending",
          profile: payload.profile || "preview",
        }),
      }
    );
  },

  cancelQueueJob(jobId: string): Promise<{ job: QueueJobItem }> {
    return requestJson<{ job: QueueJobItem }>(
      `/api/queue/${encodeURIComponent(jobId)}/cancel`,
      { method: "POST" }
    );
  },

  clearQueueHistory(): Promise<{ jobs: QueueJobItem[] }> {
    return requestJson<{ jobs: QueueJobItem[] }>("/api/queue/clear-history", {
      method: "POST",
    });
  },

  addScenePin(
    slug: string,
    sceneId: string,
    payload: { x_pct: number; y_pct: number; time_ms: number; note: string }
  ): Promise<{ scene: SceneData; pin: ReviewPin }> {
    return requestJson<{ scene: SceneData; pin: ReviewPin }>(
      `/api/projects/${encodeURIComponent(slug)}/scenes/${encodeURIComponent(sceneId)}/pins`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
  },

  updateScenePin(
    slug: string,
    sceneId: string,
    pinId: string,
    payload: { resolved?: boolean; note?: string }
  ): Promise<{ scene: SceneData; pin: ReviewPin }> {
    return requestJson<{ scene: SceneData; pin: ReviewPin }>(
      `/api/projects/${encodeURIComponent(slug)}/scenes/${encodeURIComponent(sceneId)}/pins/${encodeURIComponent(pinId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      }
    );
  },

  deleteScenePin(
    slug: string,
    sceneId: string,
    pinId: string
  ): Promise<{ scene: SceneData; deleted_pin_id: string }> {
    return requestJson<{ scene: SceneData; deleted_pin_id: string }>(
      `/api/projects/${encodeURIComponent(slug)}/scenes/${encodeURIComponent(sceneId)}/pins/${encodeURIComponent(pinId)}`,
      { method: "DELETE" }
    );
  },

  getTier2Catalog(): Promise<Tier2CatalogResponse> {
    return requestJson<Tier2CatalogResponse>("/api/tier2/catalog");
  },

  generateTier2Scene(
    slug: string,
    sceneId: string,
    payload: { model_id: string; prompt: string; simulate_local?: boolean }
  ): Promise<Tier2GenerateResponse> {
    return requestJson<Tier2GenerateResponse>(
      `/api/projects/${encodeURIComponent(slug)}/scenes/${encodeURIComponent(sceneId)}/tier2-generate`,
      {
        method: "POST",
        body: JSON.stringify({
          model_id: payload.model_id,
          prompt: payload.prompt,
          simulate_local: payload.simulate_local ?? true,
        }),
      }
    );
  },

  updateProjectMetrics(
    slug: string,
    payload: Partial<Metrics48h>
  ): Promise<{ manifest: Manifest; metrics_48h: Metrics48h }> {
    return requestJson<{ manifest: Manifest; metrics_48h: Metrics48h }>(
      `/api/projects/${encodeURIComponent(slug)}/metrics`,
      {
        method: "PUT",
        body: JSON.stringify(payload),
      }
    );
  },

  getSeriesAnalyticsSummary(): Promise<SeriesAnalyticsSummary> {
    return requestJson<SeriesAnalyticsSummary>("/api/analytics/series-summary");
  },

  mediaUrl(slug: string, relpath: string, cacheBust?: string | number): string {
    const clean = relpath.replace(/^\/+/, "");
    const base = `/api/projects/${encodeURIComponent(slug)}/media/${clean}`;
    return cacheBust !== undefined ? `${base}?v=${cacheBust}` : base;
  },
};

export interface SseClientOptions {
  onEvent: (event: SseProgressEvent) => void;
  onStatusChange: (status: "connecting" | "live" | "reconnecting" | "offline") => void;
  onErrorLog?: (msg: string) => void;
}

export function subscribeProjectEvents(
  slug: string,
  options: SseClientOptions
): () => void {
  let closed = false;
  let source: EventSource | null = null;
  let retryTimer: number | null = null;
  let retryDelayMs = 1500;

  const safeParse = (
    eventType: SseProgressEvent["eventType"],
    rawData: string
  ): SseProgressEvent => {
    try {
      const parsed = JSON.parse(rawData) as Record<string, unknown>;
      return {
        eventType,
        stage: typeof parsed.stage === "string" ? parsed.stage : undefined,
        scene_id: typeof parsed.scene_id === "string" ? parsed.scene_id : null,
        progress_pct:
          typeof parsed.progress_pct === "number" ? parsed.progress_pct : undefined,
        message: typeof parsed.message === "string" ? parsed.message : undefined,
        done: typeof parsed.done === "boolean" ? parsed.done : eventType === "done",
        error: typeof parsed.error === "string" ? parsed.error : undefined,
        job_id: typeof parsed.job_id === "string" ? parsed.job_id : undefined,
        profile: typeof parsed.profile === "string" ? parsed.profile : undefined,
        ts: typeof parsed.ts === "string" ? parsed.ts : undefined,
      };
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Payload SSE malformado";
      options.onErrorLog?.(`[SSE parse] ${msg}`);
      return { eventType, message: rawData };
    }
  };

  const connect = () => {
    if (closed) return;
    options.onStatusChange(retryDelayMs > 1500 ? "reconnecting" : "connecting");

    const url = `/api/projects/${encodeURIComponent(slug)}/events`;
    const es = new EventSource(url);
    source = es;

    es.onopen = () => {
      if (closed) return;
      retryDelayMs = 1500;
      options.onStatusChange("live");
    };

    const bind = (type: SseProgressEvent["eventType"]) => {
      es.addEventListener(type, (ev) => {
        if (closed) return;
        const msgEvent = ev as MessageEvent<string>;
        options.onEvent(safeParse(type, msgEvent.data));
      });
    };

    bind("progress");
    bind("done");
    bind("error");
    bind("heartbeat");

    es.onmessage = (ev) => {
      if (closed) return;
      const parsed = safeParse("progress", ev.data);
      if (parsed.error) parsed.eventType = "error";
      else if (parsed.done) parsed.eventType = "done";
      options.onEvent(parsed);
    };

    es.onerror = () => {
      if (closed) return;
      es.close();
      source = null;
      options.onStatusChange("reconnecting");
      options.onErrorLog?.(
        `Conexão SSE interrompida para '${slug}'. Reconectando em ${Math.round(retryDelayMs / 1000)}s.`
      );
      retryTimer = window.setTimeout(() => {
        retryDelayMs = Math.min(retryDelayMs * 1.6, 12000);
        connect();
      }, retryDelayMs);
    };
  };

  connect();

  return () => {
    closed = true;
    if (retryTimer !== null) window.clearTimeout(retryTimer);
    if (source) source.close();
    options.onStatusChange("offline");
  };
}
