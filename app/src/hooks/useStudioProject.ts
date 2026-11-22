// app/src/hooks/useStudioProject.ts
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, studioApi, subscribeProjectEvents } from "../services/api";
import type {
  AudioCapabilities,
  Briefing,
  CloneWorkflowPayload,
  GenerateTtsPayload,
  Metrics48h,
  ProjectDetail,
  ProjectSummary,
  QueueActionType,
  QueueStatusResponse,
  SceneData,
  ScriptData,
  SeriesAnalyticsSummary,
  SseProgressEvent,
  TemplateManifestItem,
  Tier2CatalogResponse,
  ToastNotice,
  TtsPreviewResponse,
  VoiceSampleInfo,
} from "../types/studio";

const DEFAULT_TEMPLATES: TemplateManifestItem[] = [
  {
    id: "paper_collage",
    label: "Paper Collage & Cutout",
    tier: 1,
    default_cost_usd: 0.0,
    description:
      "Colagem tátil estilo Vox com textura de pergaminho, rasgo de papel, carimbo e recorte central.",
    recommended_formats: ["perdido_traducao", "mito_vs_texto"],
    editable_fields: [
      {
        key: "headline",
        label: "Headline da Cena",
        type: "text",
        placeholder: "MAKÁRIOS",
      },
      {
        key: "subtext",
        label: "Subtext / Contexto",
        type: "text",
        placeholder: "Grego · Mateus 5",
      },
      {
        key: "original_term",
        label: "Termo Original (Grego/Hebraico)",
        type: "text",
        placeholder: "μακάριος (makários)",
      },
      {
        key: "stamp_text",
        label: "Carimbo / Selo Editorial",
        type: "text",
        placeholder: "ORIGINAL GREGO",
      },
    ],
  },
  {
    id: "bible_quote_card",
    label: "Cartão de Citação Bíblica",
    tier: 1,
    default_cost_usd: 0.0,
    description:
      "Pergaminho editorial com versículo verificado, marca-texto dourado sincronizado e selo de tradução.",
    recommended_formats: [
      "perdido_traducao",
      "mito_vs_texto",
      "conexao_at_nt",
    ],
    editable_fields: [
      {
        key: "headline",
        label: "Referência / Destaque",
        type: "text",
        placeholder: "MATEUS 5:3 (NVI)",
      },
      {
        key: "subtext",
        label: "Nota Exegética",
        type: "text",
        placeholder: "Sermão do Monte",
      },
      {
        key: "original_term",
        label: "Expressão-Chave a Grifar",
        type: "text",
        placeholder: "pobres em espírito",
      },
      {
        key: "stamp_text",
        label: "Selo de Tradução",
        type: "text",
        placeholder: "TEXTO VERIFICADO",
      },
    ],
  },
  {
    id: "kinetic_captions",
    label: "Tipografia Cinética Vox",
    tier: 1,
    default_cost_usd: 0.0,
    description:
      "Impacto tipográfico para Hooks (0–3s) e contrastes Mito vs. Texto com grifo palavra-por-palavra.",
    recommended_formats: [
      "mito_vs_texto",
      "perdido_traducao",
      "mapa_contexto",
      "conexao_at_nt",
    ],
    editable_fields: [
      {
        key: "headline",
        label: "Headline de Impacto",
        type: "text",
        placeholder: "NÃO É SÓ FELICIDADE",
      },
      {
        key: "subtext",
        label: "Subtítulo / Contraste",
        type: "text",
        placeholder: "O que o texto realmente diz",
      },
      {
        key: "original_term",
        label: "Termo em Contraste",
        type: "text",
        placeholder: "MITO vs. TEXTO",
      },
      {
        key: "stamp_text",
        label: "Carimbo Superior",
        type: "text",
        placeholder: "GANCHO 0–3S",
      },
    ],
  },
  {
    id: "timeline_map",
    label: "Mapa & Linha do Tempo SVG",
    tier: 1,
    default_cost_usd: 0.0,
    description:
      "Cartografia histórica com rota SVG animada (stroke-dashoffset) e linha do tempo AT -> NT.",
    recommended_formats: ["mapa_contexto", "conexao_at_nt"],
    editable_fields: [
      {
        key: "headline",
        label: "Título / Marco Principal",
        type: "text",
        placeholder: "ROTA: GALILEIA → JERUSALÉM",
      },
      {
        key: "subtext",
        label: "Coordenadas / Contexto",
        type: "text",
        placeholder: "120 km · Contexto Histórico",
      },
      {
        key: "original_term",
        label: "Origem → Destino (ou Época AT → NT)",
        type: "text",
        placeholder: "Cafarnaum → Jerusalém",
      },
      {
        key: "stamp_text",
        label: "Selo Cartográfico / Carimbo",
        type: "text",
        placeholder: "ROTA HISTÓRICA",
      },
    ],
  },
  {
    id: "tier2_video",
    label: "Nível 2 · Vídeo / 3D Generativo",
    tier: 2,
    default_cost_usd: 0.19,
    description:
      "Cena cinematográfica Nível 2 sob teto rígido USD (com modo Simulação Local $0.00).",
    recommended_formats: ["mapa_contexto", "conexao_at_nt"],
    editable_fields: [
      {
        key: "headline",
        label: "Headline Sobreposta",
        type: "text",
        placeholder: "JERUSALÉM · SÉCULO I",
      },
      {
        key: "subtext",
        label: "Legenda / Contexto",
        type: "text",
        placeholder: "Reconstrução visual",
      },
      {
        key: "original_term",
        label: "Detalhe Histórico",
        type: "text",
        placeholder: "Templo de Herodes",
      },
      {
        key: "stamp_text",
        label: "Selo Nível 2",
        type: "text",
        placeholder: "TIER 2 MOTION",
      },
    ],
  },
];

const DEFAULT_TIER2_CATALOG: Tier2CatalogResponse = {
  models: [
    {
      id: "hailuo_3",
      model_id: "hailuo_3",
      provider: "openrouter",
      kind: "video",
      cost_usd: 0.48,
      label: "Hailuo 3 Max (6s 720p · Fiel ao layout)",
    },
    {
      id: "grok_imagine_lite",
      model_id: "grok_imagine_lite",
      provider: "openrouter",
      kind: "video",
      cost_usd: 0.19,
      label: "Grok Imagine 1.5 Lite (Rascunho rápido)",
    },
    {
      id: "gpt_image_2",
      model_id: "gpt_image_2",
      provider: "openrouter",
      kind: "image",
      cost_usd: 0.08,
      label: "GPT Image 2 (Recorte Paper Collage)",
    },
    {
      id: "fal_trellis_3d",
      model_id: "fal_trellis_3d",
      provider: "fal",
      kind: "3d",
      cost_usd: 0.25,
      label: "Fal.ai Image-to-3D GLB (Opcional)",
    },
  ],
  enable_tier2_video: false,
  enable_fal_3d: false,
  max_cost_per_scene_usd: 0.5,
  max_cost_per_video_usd: 2.5,
};

export interface RenderProgressState {
  active: boolean;
  stage: string;
  sceneId: string | null;
  progressPct: number;
  message: string;
  error: string | null;
}

const INITIAL_PROGRESS: RenderProgressState = {
  active: false,
  stage: "idle",
  sceneId: null,
  progressPct: 0,
  message: "Pronto para renderização determinística.",
  error: null,
};

function extractErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.detail;
  if (err instanceof Error) return err.message;
  return "Erro inesperado de comunicação com a API.";
}

export function useStudioProject() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({});
  const [sseStatus, setSseStatus] = useState<
    "connecting" | "live" | "reconnecting" | "offline"
  >("offline");
  const [renderProgress, setRenderProgress] =
    useState<RenderProgressState>(INITIAL_PROGRESS);
  const [toasts, setToasts] = useState<ToastNotice[]>([]);
  const [mediaRevision, setMediaRevision] = useState<number>(1);
  const [audioCapabilities, setAudioCapabilities] =
    useState<AudioCapabilities | null>(null);
  const [ttsPreview, setTtsPreview] = useState<TtsPreviewResponse | null>(null);
  const [templates, setTemplates] =
    useState<TemplateManifestItem[]>(DEFAULT_TEMPLATES);
  const [tier2Catalog, setTier2Catalog] =
    useState<Tier2CatalogResponse>(DEFAULT_TIER2_CATALOG);
  const [queueState, setQueueState] = useState<QueueStatusResponse>({
    active_job_id: null,
    jobs: [],
  });
  const [seriesAnalytics, setSeriesAnalytics] =
    useState<SeriesAnalyticsSummary | null>(null);

  const activeSlugRef = useRef<string | null>(null);
  activeSlugRef.current = activeSlug;

  const pushToast = useCallback(
    (tone: ToastNotice["tone"], message: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-3), { id, tone, message }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== id));
      }, 5200);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const withBusy = useCallback(
    async <T,>(key: string, fn: () => Promise<T>): Promise<T> => {
      setBusyMap((prev) => ({ ...prev, [key]: true }));
      try {
        return await fn();
      } finally {
        setBusyMap((prev) => ({ ...prev, [key]: false }));
      }
    },
    []
  );

  const refreshProjectsList = useCallback(async (): Promise<ProjectSummary[]> => {
    const res = await studioApi.listProjects();
    const list = res.projects || [];
    setProjects(list);
    return list;
  }, []);

  const refreshAudioCapabilities =
    useCallback(async (): Promise<AudioCapabilities | null> => {
      try {
        const caps = await studioApi.getAudioCapabilities();
        setAudioCapabilities(caps);
        return caps;
      } catch (err) {
        console.warn("[Studio] Falha ao consultar capacidades de áudio:", err);
        return null;
      }
    }, []);

  const refreshTemplates = useCallback(async (): Promise<
    TemplateManifestItem[]
  > => {
    try {
      const res = await studioApi.getTemplates();
      if (Array.isArray(res.templates) && res.templates.length > 0) {
        setTemplates(res.templates);
        return res.templates;
      }
    } catch (err) {
      console.warn("[Studio] Usando catálogo local de templates:", err);
    }
    return DEFAULT_TEMPLATES;
  }, []);

  const refreshTier2Catalog =
    useCallback(async (): Promise<Tier2CatalogResponse> => {
      try {
        const cat = await studioApi.getTier2Catalog();
        setTier2Catalog(cat);
        return cat;
      } catch (err) {
        console.warn("[Studio] Usando catálogo padrão Nível 2:", err);
        return DEFAULT_TIER2_CATALOG;
      }
    }, []);

  const refreshQueue = useCallback(async (): Promise<QueueStatusResponse> => {
    try {
      const q = await studioApi.getQueue();
      setQueueState(q);
      return q;
    } catch (err) {
      console.warn("[Studio] Falha ao consultar fila:", err);
      return { active_job_id: null, jobs: [] };
    }
  }, []);

  const refreshSeriesAnalytics =
    useCallback(async (): Promise<SeriesAnalyticsSummary | null> => {
      try {
        const summary = await studioApi.getSeriesAnalyticsSummary();
        setSeriesAnalytics(summary);
        return summary;
      } catch (err) {
        console.warn("[Studio] Falha ao consultar analytics de séries:", err);
        return null;
      }
    }, []);

  const loadProject = useCallback(
    async (slug: string) => {
      setLoading(true);
      try {
        const detail = await studioApi.getProject(slug);
        setProject(detail);
        setActiveSlug(detail.manifest.slug);
        setRenderProgress(INITIAL_PROGRESS);
        setTtsPreview(null);
        setMediaRevision((v) => v + 1);
      } catch (err) {
        pushToast("error", `Falha ao abrir projeto '${slug}': ${extractErrorMessage(err)}`);
      } finally {
        setLoading(false);
      }
    },
    [pushToast]
  );

  // Boot inicial: carrega lista, capacidades de áudio, templates, fila, analytics e abre 'piloto-makarios' por padrão
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const [list] = await Promise.all([
          refreshProjectsList(),
          refreshAudioCapabilities(),
          refreshTemplates(),
          refreshTier2Catalog(),
          refreshQueue(),
          refreshSeriesAnalytics(),
        ]);
        if (!mounted) return;
        const preferred =
          list.find((p) => p.slug === "piloto-makarios") || list[0];
        if (preferred) {
          const detail = await studioApi.getProject(preferred.slug);
          if (!mounted) return;
          setProject(detail);
          setActiveSlug(detail.manifest.slug);
        }
      } catch (err) {
        if (mounted) {
          pushToast(
            "error",
            `Servidor FastAPI indisponível ou erro inicial: ${extractErrorMessage(err)}`
          );
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [
    refreshProjectsList,
    refreshAudioCapabilities,
    refreshTemplates,
    refreshTier2Catalog,
    refreshQueue,
    refreshSeriesAnalytics,
    pushToast,
  ]);

  // Assinatura SSE ao vivo por projeto
  useEffect(() => {
    if (!activeSlug) return;

    const handleSseEvent = (ev: SseProgressEvent) => {
      if (ev.eventType === "heartbeat") return;

      if (ev.eventType === "error") {
        const errMsg = ev.error || ev.message || "Falha durante o job de produção.";
        setRenderProgress((prev) => ({
          ...prev,
          active: false,
          stage: ev.stage || "error",
          message: errMsg,
          error: errMsg,
        }));
        pushToast("error", errMsg);
        return;
      }

      if (ev.eventType === "done" || ev.done) {
        const defaultDoneMsg =
          ev.stage === "tts_generate"
            ? "Narração TTS gerada e sincronizada!"
            : "Renderização concluída!";
        setRenderProgress({
          active: false,
          stage: ev.stage || "done",
          sceneId: ev.scene_id || null,
          progressPct: 100,
          message: ev.message || defaultDoneMsg,
          error: null,
        });
        pushToast("success", ev.message || defaultDoneMsg);
        const slugNow = activeSlugRef.current;
        if (slugNow) {
          studioApi
            .getProject(slugNow)
            .then((fresh) => {
              setProject(fresh);
              setMediaRevision((v) => v + 1);
            })
            .catch((err) => {
              pushToast("warning", `Recarregamento pós-render falhou: ${extractErrorMessage(err)}`);
            });
          refreshProjectsList().catch((err) => {
            console.warn("[Studio] Falha ao atualizar lista de projetos:", err);
          });
        }
        return;
      }

      // Evento progress (etapas pontuais como audio_align / scene_regenerate encerram em 100%)
      const isPointStage =
        ev.stage === "scene_regenerate" || ev.stage === "audio_align";
      const pointFinished =
        isPointStage && typeof ev.progress_pct === "number" && ev.progress_pct >= 100;

      setRenderProgress((prev) => ({
        active: pointFinished ? false : true,
        stage: ev.stage || prev.stage,
        sceneId: ev.scene_id ?? prev.sceneId,
        progressPct:
          typeof ev.progress_pct === "number" ? ev.progress_pct : prev.progressPct,
        message: ev.message || prev.message,
        error: null,
      }));

      if (pointFinished) {
        const slugNow = activeSlugRef.current;
        if (slugNow) {
          studioApi
            .getProject(slugNow)
            .then((fresh) => {
              setProject(fresh);
              setMediaRevision((v) => v + 1);
            })
            .catch((err) => {
              console.warn("[Studio] Falha ao sincronizar após etapa pontual:", err);
            });
        }
      }
    };

    const unsubscribe = subscribeProjectEvents(activeSlug, {
      onEvent: handleSseEvent,
      onStatusChange: setSseStatus,
      onErrorLog: (msg) => console.warn("[Studio SSE]", msg),
    });

    return unsubscribe;
  }, [activeSlug, pushToast, refreshProjectsList]);

  // ---- AÇÕES DO PROJETO ----

  const refreshCurrentProject = useCallback(
    async (bumpMedia = false) => {
      const slugNow = activeSlugRef.current;
      if (!slugNow) return null;
      const fresh = await studioApi.getProject(slugNow);
      setProject(fresh);
      if (bumpMedia) {
        setMediaRevision((v) => v + 1);
      }
      return fresh;
    },
    []
  );

  const createNewProject = useCallback(
    async (payload: {
      title: string;
      raw_idea: string;
      seed_reference?: string;
      bible_translation?: string;
    }) => {
      return withBusy("create_project", async () => {
        const created = await studioApi.createProject(payload);
        setProject(created);
        setActiveSlug(created.manifest.slug);
        setRenderProgress(INITIAL_PROGRESS);
        setTtsPreview(null);
        setMediaRevision((v) => v + 1);
        await refreshProjectsList();
        pushToast(
          "success",
          `Projeto '${created.manifest.title}' criado com recomendação de série.`
        );
        return created;
      });
    },
    [withBusy, refreshProjectsList, pushToast]
  );

  const cloneWorkflow = useCallback(
    async (sourceSlug: string, payload: CloneWorkflowPayload) => {
      return withBusy("clone_workflow", async () => {
        const created = await studioApi.cloneWorkflow(sourceSlug, payload);
        setProject(created);
        setActiveSlug(created.manifest.slug);
        setRenderProgress(INITIAL_PROGRESS);
        setTtsPreview(null);
        setMediaRevision((v) => v + 1);
        await refreshProjectsList();
        pushToast(
          "success",
          `Novo episódio '${created.manifest.title}' criado herdando estilo (Ep. #${created.manifest.series.episode_number}).`
        );
        return created;
      });
    },
    [withBusy, refreshProjectsList, pushToast]
  );

  const recommendBriefing = useCallback(
    async (rawIdea: string, seedReference: string | null) => {
      if (!activeSlug) return;
      return withBusy("briefing_recommend", async () => {
        const res = await studioApi.recommendBriefing(activeSlug, {
          raw_idea: rawIdea,
          seed_reference: seedReference || undefined,
        });
        setProject((prev) =>
          prev
            ? {
                ...prev,
                briefing: res.briefing,
                manifest: {
                  ...prev.manifest,
                  series: {
                    ...prev.manifest.series,
                    format_type: res.briefing.selected_format_type,
                    series_id: res.briefing.selected_format_type,
                  },
                },
              }
            : prev
        );
        pushToast(
          "info",
          `Série recomendada: ${res.recommended_format.format_type} (${Math.round(res.recommended_format.confidence * 100)}%).`
        );
      });
    },
    [activeSlug, withBusy, pushToast]
  );

  const saveBriefing = useCallback(
    async (nextBriefing: Briefing) => {
      if (!activeSlug) return;
      return withBusy("briefing_save", async () => {
        const res = await studioApi.updateBriefing(activeSlug, nextBriefing);
        if ("preset" in res && "artifacts" in res) {
          setProject(res as ProjectDetail);
        } else {
          const updatedBriefing =
            "briefing" in res ? (res as { briefing: Briefing }).briefing : (res as Briefing);
          const updatedManifest =
            "manifest" in res ? (res as { manifest: ProjectDetail["manifest"] }).manifest : null;
          setProject((prev) =>
            prev
              ? {
                  ...prev,
                  briefing: updatedBriefing,
                  manifest: updatedManifest ?? {
                    ...prev.manifest,
                    series: {
                      ...prev.manifest.series,
                      format_type: updatedBriefing.selected_format_type,
                      series_id: updatedBriefing.selected_format_type,
                    },
                  },
                }
              : prev
          );
        }
        await refreshProjectsList();
        pushToast("success", "Briefing salvo.");
      });
    },
    [activeSlug, withBusy, refreshProjectsList, pushToast]
  );

  const generateScript = useCallback(
    async (useLlm = false) => {
      if (!activeSlug) return;
      return withBusy("script_generate", async () => {
        const res = await studioApi.generateScript(activeSlug, { use_llm: useLlm });
        if ("manifest" in res && "briefing" in res) {
          setProject(res as ProjectDetail);
        } else {
          const fresh = await studioApi.getProject(activeSlug);
          setProject(fresh);
        }
        setTtsPreview(null);
        pushToast("success", "Roteiro e 3 Hooks (0–3s) gerados!");
      });
    },
    [activeSlug, withBusy, pushToast]
  );

  const refineScript = useCallback(
    async (
      instruction: string,
      target: "hooks" | "segments" | "distribution"
    ) => {
      if (!activeSlug) return;
      return withBusy("script_refine", async () => {
        const res = await studioApi.refineScript(activeSlug, {
          instruction,
          target,
        });
        setProject((prev) => (prev ? { ...prev, script: res.script } : prev));
        setTtsPreview(null);
        pushToast(
          "success",
          `Nó refinado (${target} · modo ${res.mode === "llm" ? "LLM" : "Editorial Local"}).`
        );
      });
    },
    [activeSlug, withBusy, pushToast]
  );

  const saveScript = useCallback(
    async (nextScript: ScriptData, silent = false) => {
      if (!activeSlug) return;
      return withBusy("script_save", async () => {
        const res = await studioApi.updateScript(activeSlug, nextScript);
        if ("preset" in res && "artifacts" in res) {
          setProject(res as ProjectDetail);
        } else {
          const updatedScript =
            "script" in res ? (res as { script: ScriptData }).script : (res as ScriptData);
          const updatedManifest =
            "manifest" in res ? (res as { manifest: ProjectDetail["manifest"] }).manifest : null;
          setProject((prev) =>
            prev
              ? {
                  ...prev,
                  script: updatedScript,
                  manifest: updatedManifest ?? prev.manifest,
                }
              : prev
          );
        }
        setTtsPreview(null);
        if (!silent) pushToast("success", "Roteiro atualizado.");
      });
    },
    [activeSlug, withBusy, pushToast]
  );

  const approveGate1 = useCallback(async () => {
    if (!activeSlug) return;
    return withBusy("script_approve", async () => {
      const updated = await studioApi.approveScriptGate1(activeSlug);
      setProject(updated);
      await refreshProjectsList();
      pushToast(
        "success",
        `Gate 1 aprovado! ${updated.scenes.length} cenas 9:16 geradas no canvas.`
      );
      return updated;
    });
  }, [activeSlug, withBusy, refreshProjectsList, pushToast]);

  const uploadAudio = useCallback(
    async (file: File) => {
      if (!activeSlug) return;
      return withBusy("audio_upload", async () => {
        const res = await studioApi.uploadAudio(activeSlug, file);
        const fresh = await studioApi.getProject(activeSlug);
        setProject(fresh);
        setMediaRevision((v) => v + 1);
        pushToast(
          "success",
          `Áudio enviado (${(res.duration_ms / 1000).toFixed(1)}s). Pronto para alinhar word_id.`
        );
      });
    },
    [activeSlug, withBusy, pushToast]
  );

  const alignAudio = useCallback(
    async (audioSource?: "recorded" | "pilot") => {
      if (!activeSlug) return;
      return withBusy("audio_align", async () => {
        const updated = await studioApi.alignAudio(activeSlug, audioSource);
        setProject(updated);
        setMediaRevision((v) => v + 1);
        await refreshProjectsList();
        pushToast(
          "success",
          `Metrônomo word_id sincronizado (${updated.audio_alignment?.words.length ?? 0} palavras).`
        );
      });
    },
    [activeSlug, withBusy, refreshProjectsList, pushToast]
  );

  const uploadVoiceSample = useCallback(
    async (file: File, name?: string): Promise<VoiceSampleInfo | null> => {
      return withBusy("voice_sample_upload", async () => {
        try {
          const res = await studioApi.uploadVoiceSample(file, name);
          await refreshAudioCapabilities();
          if (res.sample.warning) {
            pushToast(
              "warning",
              `Amostra '${res.sample.filename}' (${res.sample.duration_sec.toFixed(1)}s): ${res.sample.warning}`
            );
          } else {
            pushToast(
              "success",
              `Amostra de voz '${res.sample.filename}' pronta (${res.sample.duration_sec.toFixed(1)}s).`
            );
          }
          return res.sample;
        } catch (err) {
          pushToast(
            "error",
            `Falha ao enviar amostra de voz: ${extractErrorMessage(err)}`
          );
          return null;
        }
      });
    },
    [withBusy, refreshAudioCapabilities, pushToast]
  );

  const deleteVoiceSample = useCallback(
    async (sampleId: string): Promise<boolean> => {
      return withBusy("voice_sample_delete", async () => {
        try {
          await studioApi.deleteVoiceSample(sampleId);
          await refreshAudioCapabilities();
          pushToast("info", `Amostra '${sampleId}' removida.`);
          return true;
        } catch (err) {
          pushToast(
            "error",
            `Falha ao excluir amostra '${sampleId}': ${extractErrorMessage(err)}`
          );
          return false;
        }
      });
    },
    [withBusy, refreshAudioCapabilities, pushToast]
  );

  const previewTtsText = useCallback(async (): Promise<TtsPreviewResponse | null> => {
    if (!activeSlug) return null;
    return withBusy("tts_preview", async () => {
      try {
        const preview = await studioApi.previewTtsText(activeSlug);
        setTtsPreview(preview);
        return preview;
      } catch (err) {
        pushToast(
          "error",
          `Falha ao normalizar texto pré-TTS: ${extractErrorMessage(err)}`
        );
        return null;
      }
    });
  }, [activeSlug, withBusy, pushToast]);

  const generateTtsAudio = useCallback(
    async (payload: GenerateTtsPayload) => {
      if (!activeSlug) return null;
      return withBusy("tts_generate", async () => {
        setRenderProgress({
          active: true,
          stage: "tts_generate",
          sceneId: null,
          progressPct: 4,
          message: `Iniciando síntese local (${payload.engine})...`,
          error: null,
        });
        try {
          const res = await studioApi.generateTtsAudio(activeSlug, payload);
          pushToast(
            "info",
            `Síntese TTS (${res.engine}) iniciada (${res.job_id}).`
          );
          return res;
        } catch (err) {
          const msg = extractErrorMessage(err);
          setRenderProgress({
            active: false,
            stage: "tts_generate",
            sceneId: null,
            progressPct: 0,
            message: msg,
            error: msg,
          });
          pushToast("error", msg);
          return null;
        }
      });
    },
    [activeSlug, withBusy, pushToast]
  );

  const updateScene = useCallback(
    async (sceneId: string, patch: Partial<SceneData>) => {
      if (!activeSlug) return;
      return withBusy(`scene_save_${sceneId}`, async () => {
        const res = await studioApi.updateScene(activeSlug, sceneId, patch);
        const updatedScene = "scene" in res ? res.scene : res;
        setProject((prev) => {
          if (!prev) return prev;
          const nextScenes = prev.scenes.map((sc) =>
            sc.scene_id === sceneId ? updatedScene : sc
          );
          const allApproved =
            nextScenes.length > 0 &&
            nextScenes.every(
              (s) => s.status === "approved" || s.status === "rendered"
            );
          return {
            ...prev,
            scenes: nextScenes,
            manifest: {
              ...prev.manifest,
              gates: { ...prev.manifest.gates, scenes_approved: allApproved },
            },
          };
        });
        await refreshCurrentProject(false).catch((err) => {
          console.warn("[Studio] Falha ao recalcular status reativo da cena:", err);
        });
        pushToast("success", `Cena ${sceneId.toUpperCase()} atualizada.`);
        return updatedScene;
      });
    },
    [activeSlug, withBusy, refreshCurrentProject, pushToast]
  );

  const uploadSceneAsset = useCallback(
    async (
      sceneId: string,
      file: File,
      options?: { asset_id?: string; apply_rembg?: boolean }
    ) => {
      if (!activeSlug) return;
      return withBusy(`scene_asset_${sceneId}`, async () => {
        const res = await studioApi.uploadSceneAsset(
          activeSlug,
          sceneId,
          file,
          options
        );
        setProject((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            scenes: prev.scenes.map((sc) =>
              sc.scene_id === sceneId ? res.scene : sc
            ),
          };
        });
        await refreshCurrentProject(true).catch((err) => {
          console.warn("[Studio] Falha ao recalcular runtime pós-upload:", err);
          setMediaRevision((v) => v + 1);
        });
        pushToast(
          "success",
          `Arte Gemini PRO anexada em ${sceneId.toUpperCase()}.`
        );
        return res;
      });
    },
    [activeSlug, withBusy, refreshCurrentProject, pushToast]
  );

  const regenerateScene = useCallback(
    async (sceneId: string, profile: "preview" | "final" = "preview") => {
      if (!activeSlug) return;
      return withBusy(`scene_regen_${sceneId}`, async () => {
        const res = await studioApi.regenerateScene(activeSlug, sceneId, {
          profile,
          force: true,
        });
        setProject((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            scenes: prev.scenes.map((sc) =>
              sc.scene_id === sceneId ? res.scene : sc
            ),
          };
        });
        await refreshCurrentProject(true).catch((err) => {
          console.warn("[Studio] Falha ao sincronizar miniatura pós-regen:", err);
          setMediaRevision((v) => v + 1);
        });
        pushToast(
          "success",
          `Cena ${sceneId.toUpperCase()} regenerada (${profile}${res.cache_hit ? " · cache hit" : ""}).`
        );
        return res;
      });
    },
    [activeSlug, withBusy, refreshCurrentProject, pushToast]
  );

  const runPending = useCallback(
    async (profile: "preview" | "final" = "preview") => {
      if (!activeSlug) return;
      return withBusy("run_pending", async () => {
        const res = await studioApi.runPending(activeSlug, { profile });
        if (res.status === "noop") {
          await refreshCurrentProject(false).catch((err) => {
            console.warn("[Studio] Falha ao sincronizar após noop:", err);
          });
          pushToast(
            "info",
            res.message || "Tudo em dia! Nenhuma etapa pendente."
          );
          return res;
        }
        setRenderProgress({
          active: true,
          stage: "run_pending",
          sceneId: res.stale_scene_ids?.[0] ?? null,
          progressPct: 6,
          message:
            res.message ||
            `Executando ${res.pending_count} pendência(s) no perfil ${profile}...`,
          error: null,
        });
        pushToast(
          "info",
          res.message ||
            `Executando ${res.pending_count} etapa(s) pendente(s) (${res.job_id || "SSE"}).`
        );
        return res;
      });
    },
    [activeSlug, withBusy, refreshCurrentProject, pushToast]
  );

  const startRender = useCallback(
    async (profile: "preview" | "final", force = false) => {
      if (!activeSlug) return;
      return withBusy(`render_${profile}`, async () => {
        setRenderProgress({
          active: true,
          stage: "starting",
          sceneId: null,
          progressPct: 3,
          message:
            profile === "final"
              ? "Iniciando render final 1080×1920 @ 30fps..."
              : "Iniciando render preview 540×960 @ 15fps...",
          error: null,
        });
        const res = await studioApi.startRender(activeSlug, { profile, force });
        pushToast("info", `Job de render iniciado (${res.job_id}).`);
        return res;
      });
    },
    [activeSlug, withBusy, pushToast]
  );

  const generateCover = useCallback(async () => {
    if (!activeSlug) return;
    return withBusy("generate_cover", async () => {
      const res = await studioApi.generateCover(activeSlug);
      setProject((prev) =>
        prev
          ? {
              ...prev,
              artifacts: {
                ...prev.artifacts,
                has_cover: true,
                cover_url: res.cover_url,
              },
            }
          : prev
      );
      setMediaRevision((v) => v + 1);
      pushToast("success", "Capa PNG 1080×1920 gerada na área segura!");
      return res;
    });
  }, [activeSlug, withBusy, pushToast]);

  // ---- FASE 4: PINS DE REVISÃO, NÍVEL 2 CIRÚRGICO, FILA & MÉTRICAS 48H ----

  // Polling leve da fila enquanto houver job ativo/enfileirado
  useEffect(() => {
    const hasPendingJobs =
      Boolean(queueState.active_job_id) ||
      queueState.jobs.some(
        (j) => j.status === "queued" || j.status === "running"
      );
    if (!hasPendingJobs) return;

    const timer = window.setInterval(() => {
      void refreshQueue();
    }, 1800);

    return () => window.clearInterval(timer);
  }, [queueState, refreshQueue]);

  const addScenePin = useCallback(
    async (
      sceneId: string,
      payload: { x_pct: number; y_pct: number; time_ms: number; note: string }
    ) => {
      if (!activeSlug) return null;
      return withBusy(`scene_pin_${sceneId}`, async () => {
        try {
          const res = await studioApi.addScenePin(activeSlug, sceneId, payload);
          setProject((prev) => {
            if (!prev) return prev;
            const nextScenes = prev.scenes.map((sc) =>
              sc.scene_id === sceneId ? res.scene : sc
            );
            const allApproved =
              nextScenes.length > 0 &&
              nextScenes.every(
                (s) => s.status === "approved" || s.status === "rendered"
              );
            return {
              ...prev,
              scenes: nextScenes,
              manifest: {
                ...prev.manifest,
                gates: { ...prev.manifest.gates, scenes_approved: allApproved },
              },
            };
          });
          pushToast(
            "info",
            `Pin adicionado em ${sceneId.toUpperCase()} (${(payload.time_ms / 1000).toFixed(1)}s).`
          );
          return res;
        } catch (err) {
          pushToast("error", `Falha ao salvar pin: ${extractErrorMessage(err)}`);
          return null;
        }
      });
    },
    [activeSlug, withBusy, pushToast]
  );

  const toggleScenePin = useCallback(
    async (sceneId: string, pinId: string, resolved: boolean) => {
      if (!activeSlug) return null;
      return withBusy(`scene_pin_${sceneId}`, async () => {
        try {
          const res = await studioApi.updateScenePin(
            activeSlug,
            sceneId,
            pinId,
            { resolved }
          );
          setProject((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              scenes: prev.scenes.map((sc) =>
                sc.scene_id === sceneId ? res.scene : sc
              ),
            };
          });
          pushToast(
            "success",
            resolved ? `Pin ${pinId} resolvido.` : `Pin ${pinId} reaberto.`
          );
          return res;
        } catch (err) {
          pushToast(
            "error",
            `Falha ao atualizar pin: ${extractErrorMessage(err)}`
          );
          return null;
        }
      });
    },
    [activeSlug, withBusy, pushToast]
  );

  const deleteScenePin = useCallback(
    async (sceneId: string, pinId: string) => {
      if (!activeSlug) return null;
      return withBusy(`scene_pin_${sceneId}`, async () => {
        try {
          const res = await studioApi.deleteScenePin(
            activeSlug,
            sceneId,
            pinId
          );
          setProject((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              scenes: prev.scenes.map((sc) =>
                sc.scene_id === sceneId ? res.scene : sc
              ),
            };
          });
          pushToast("info", `Pin ${pinId} removido.`);
          return res.scene;
        } catch (err) {
          pushToast(
            "error",
            `Falha ao excluir pin: ${extractErrorMessage(err)}`
          );
          return null;
        }
      });
    },
    [activeSlug, withBusy, pushToast]
  );

  const generateTier2Scene = useCallback(
    async (
      sceneId: string,
      payload: { model_id: string; prompt: string; simulate_local?: boolean }
    ) => {
      if (!activeSlug) return null;
      return withBusy(`scene_tier2_${sceneId}`, async () => {
        try {
          const res = await studioApi.generateTier2Scene(
            activeSlug,
            sceneId,
            payload
          );
          setProject((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              scenes: prev.scenes.map((sc) =>
                sc.scene_id === sceneId ? res.scene : sc
              ),
              manifest: {
                ...prev.manifest,
                cost_ledger: res.cost_ledger,
              },
            };
          });
          await refreshCurrentProject(true).catch((err) => {
            console.warn("[Studio] Falha ao recarregar pós-tier2:", err);
            setMediaRevision((v) => v + 1);
          });
          pushToast(
            "success",
            res.simulated
              ? `Nível 2 simulado localmente ($0.00) em ${sceneId.toUpperCase()}!`
              : `Arte Nível 2 (${payload.model_id}) gerada em ${sceneId.toUpperCase()}!`
          );
          return res;
        } catch (err) {
          pushToast("error", extractErrorMessage(err));
          return null;
        }
      });
    },
    [activeSlug, withBusy, refreshCurrentProject, pushToast]
  );

  const enqueueJob = useCallback(
    async (payload?: {
      slug?: string;
      action?: QueueActionType;
      profile?: "preview" | "final";
    }) => {
      const targetSlug = payload?.slug || activeSlug;
      if (!targetSlug) return null;
      return withBusy("queue_enqueue", async () => {
        try {
          const res = await studioApi.enqueueJob({
            slug: targetSlug,
            action: payload?.action || "run_pending",
            profile:
              payload?.profile ||
              (payload?.action === "render_final" ? "final" : "preview"),
          });
          await refreshQueue();
          pushToast(
            "success",
            `Job '${res.job.action}' adicionado à fila para '${res.job.title}'.`
          );
          return res;
        } catch (err) {
          pushToast(
            "error",
            `Falha ao enfileirar job: ${extractErrorMessage(err)}`
          );
          return null;
        }
      });
    },
    [activeSlug, withBusy, refreshQueue, pushToast]
  );

  const cancelQueueJob = useCallback(
    async (jobId: string) => {
      return withBusy(`queue_cancel_${jobId}`, async () => {
        try {
          await studioApi.cancelQueueJob(jobId);
          await refreshQueue();
          pushToast("info", `Job ${jobId} cancelado.`);
        } catch (err) {
          pushToast(
            "error",
            `Falha ao cancelar job: ${extractErrorMessage(err)}`
          );
        }
      });
    },
    [withBusy, refreshQueue, pushToast]
  );

  const clearQueueHistory = useCallback(async () => {
    return withBusy("queue_clear", async () => {
      try {
        const res = await studioApi.clearQueueHistory();
        setQueueState((prev) => ({
          ...prev,
          jobs: res.jobs || [],
        }));
        await refreshQueue();
        pushToast("info", "Histórico de jobs finalizados limpo.");
      } catch (err) {
        pushToast(
          "error",
          `Falha ao limpar histórico da fila: ${extractErrorMessage(err)}`
        );
      }
    });
  }, [withBusy, refreshQueue, pushToast]);

  const saveProjectMetrics = useCallback(
    async (payload: Partial<Metrics48h>) => {
      if (!activeSlug) return null;
      return withBusy("metrics_save", async () => {
        try {
          const res = await studioApi.updateProjectMetrics(activeSlug, payload);
          setProject((prev) =>
            prev
              ? {
                  ...prev,
                  manifest: res.manifest,
                }
              : prev
          );
          await refreshSeriesAnalytics();
          pushToast(
            "success",
            "Métricas de 48h salvas! Resumo analítico das séries atualizado."
          );
          return res;
        } catch (err) {
          pushToast(
            "error",
            `Falha ao salvar métricas 48h: ${extractErrorMessage(err)}`
          );
          return null;
        }
      });
    },
    [activeSlug, withBusy, refreshSeriesAnalytics, pushToast]
  );

  return {
    projects,
    activeSlug,
    project,
    loading,
    busyMap,
    sseStatus,
    renderProgress,
    toasts,
    mediaRevision,
    audioCapabilities,
    ttsPreview,
    templates,
    tier2Catalog,
    queueState,
    seriesAnalytics,
    pushToast,
    dismissToast,
    loadProject,
    refreshCurrentProject,
    refreshAudioCapabilities,
    refreshTemplates,
    refreshTier2Catalog,
    refreshQueue,
    refreshSeriesAnalytics,
    createNewProject,
    cloneWorkflow,
    recommendBriefing,
    saveBriefing,
    generateScript,
    refineScript,
    saveScript,
    approveGate1,
    uploadAudio,
    alignAudio,
    uploadVoiceSample,
    deleteVoiceSample,
    previewTtsText,
    generateTtsAudio,
    updateScene,
    uploadSceneAsset,
    regenerateScene,
    runPending,
    startRender,
    generateCover,
    addScenePin,
    toggleScenePin,
    deleteScenePin,
    generateTier2Scene,
    enqueueJob,
    cancelQueueJob,
    clearQueueHistory,
    saveProjectMetrics,
  };
}
