// app/src/components/QueueAndMetricsDrawer.tsx
import { useEffect, useState } from "react";
import {
  BarChart3,
  CheckCircle2,
  Clock,
  ListOrdered,
  Play,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import type {
  Metrics48h,
  ProjectDetail,
  ProjectSummary,
  QueueActionType,
  QueueJobItem,
  QueueStatusResponse,
  SeriesAnalyticsSummary,
} from "../types/studio";

interface QueueAndMetricsDrawerProps {
  open: boolean;
  project: ProjectDetail | null;
  projects: ProjectSummary[];
  queueState: QueueStatusResponse;
  seriesAnalytics: SeriesAnalyticsSummary | null;
  busyEnqueue: boolean;
  busyClearQueue: boolean;
  busySaveMetrics: boolean;
  onClose: () => void;
  onEnqueueJob: (payload: {
    slug?: string;
    action?: QueueActionType;
    profile?: "preview" | "final";
  }) => Promise<unknown>;
  onCancelJob: (jobId: string) => Promise<void>;
  onClearHistory: () => Promise<void>;
  onRefreshQueue: () => Promise<unknown>;
  onSaveMetrics: (payload: Partial<Metrics48h>) => Promise<unknown>;
  onRefreshAnalytics: () => Promise<unknown>;
}

const ACTION_LABELS: Record<QueueActionType, string> = {
  run_pending: "Executar Pendentes (Reativo)",
  render_preview: "Render Preview (540×960 @ 15fps)",
  render_final: "Render Final (1080×1920 @ 30fps)",
};

const FORMAT_LABELS: Record<string, string> = {
  mapa_contexto: "Série A · Mapa & Contexto",
  perdido_traducao: "Série B · Perdido na Tradução",
  mito_vs_texto: "Série C · Mito vs. Texto",
  conexao_at_nt: "Série D · Conexão AT → NT",
};

function statusBadgeClass(status: QueueJobItem["status"]): string {
  switch (status) {
    case "completed":
      return "pill-ok";
    case "running":
      return "pill-gold";
    case "queued":
      return "pill-blue";
    case "failed":
      return "pill-alert";
    case "cancelled":
    default:
      return "";
  }
}

export function QueueAndMetricsDrawer({
  open,
  project,
  projects,
  queueState,
  seriesAnalytics,
  busyEnqueue,
  busyClearQueue,
  busySaveMetrics,
  onClose,
  onEnqueueJob,
  onCancelJob,
  onClearHistory,
  onRefreshQueue,
  onSaveMetrics,
  onRefreshAnalytics,
}: QueueAndMetricsDrawerProps) {
  const [activeTab, setActiveTab] = useState<"queue" | "metrics">("queue");
  const [currentAction, setCurrentAction] =
    useState<QueueActionType>("run_pending");
  const [batchSlug, setBatchSlug] = useState<string>("");
  const [batchAction, setBatchAction] =
    useState<QueueActionType>("run_pending");

  // Formulário Métricas 48h
  const [swipedPct, setSwipedPct] = useState<string>("");
  const [retentionPct, setRetentionPct] = useState<string>("");
  const [commentsCount, setCommentsCount] = useState<string>("");

  // Sincroniza campos quando projeto muda ou abre o drawer
  useEffect(() => {
    if (!project) return;
    const m = project.manifest.metrics_48h;
    setSwipedPct(
      m?.viewed_vs_swiped_pct !== null && m?.viewed_vs_swiped_pct !== undefined
        ? String(m.viewed_vs_swiped_pct)
        : ""
    );
    setRetentionPct(
      m?.avg_retention_pct !== null && m?.avg_retention_pct !== undefined
        ? String(m.avg_retention_pct)
        : ""
    );
    setCommentsCount(
      m?.comments_count !== null && m?.comments_count !== undefined
        ? String(m.comments_count)
        : ""
    );
  }, [project?.manifest.slug, project?.manifest.metrics_48h]);

  useEffect(() => {
    if (!open) return;
    void onRefreshQueue();
    void onRefreshAnalytics();
  }, [open, onRefreshQueue, onRefreshAnalytics]);

  useEffect(() => {
    if (projects.length > 0 && !batchSlug) {
      const other =
        projects.find((p) => p.slug !== project?.manifest.slug) || projects[0];
      if (other) setBatchSlug(other.slug);
    }
  }, [projects, project?.manifest.slug, batchSlug]);

  if (!open) return null;

  const handleEnqueueCurrent = async () => {
    if (!project) return;
    await onEnqueueJob({
      slug: project.manifest.slug,
      action: currentAction,
      profile: currentAction === "render_final" ? "final" : "preview",
    });
  };

  const handleEnqueueBatch = async () => {
    const targetSlug = batchSlug || project?.manifest.slug;
    if (!targetSlug) return;
    await onEnqueueJob({
      slug: targetSlug,
      action: batchAction,
      profile: batchAction === "render_final" ? "final" : "preview",
    });
  };

  const handleSaveMetricsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project) return;
    const parsedSwiped =
      swipedPct.trim() !== "" ? Number(swipedPct) : null;
    const parsedRetention =
      retentionPct.trim() !== "" ? Number(retentionPct) : null;
    const parsedComments =
      commentsCount.trim() !== "" ? Math.round(Number(commentsCount)) : null;

    await onSaveMetrics({
      published_at:
        project.manifest.metrics_48h?.published_at ||
        new Date().toISOString(),
      viewed_vs_swiped_pct:
        parsedSwiped !== null && !Number.isNaN(parsedSwiped)
          ? parsedSwiped
          : null,
      avg_retention_pct:
        parsedRetention !== null && !Number.isNaN(parsedRetention)
          ? parsedRetention
          : null,
      comments_count:
        parsedComments !== null && !Number.isNaN(parsedComments)
          ? parsedComments
          : null,
    });
  };

  const jobs = queueState.jobs || [];

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="queue-metrics-drawer"
        data-testid="queue-metrics-drawer"
        onClick={(e) => e.stopPropagation()}
        aria-label="Fila de Execução e Métricas 48h"
      >
        <div className="drawer-header">
          <div>
            <div className="drawer-title">
              <BarChart3 size={16} color="#E5A93C" />
              <span>Escala Controlada · Fila & Loop 48h</span>
            </div>
            <div className="drawer-subtitle">
              1 vídeo por padrão · Lote sob demanda & inteligência de série
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            data-testid="btn-close-queue-drawer"
            onClick={onClose}
            aria-label="Fechar painel"
          >
            <X size={16} />
          </button>
        </div>

        <div className="drawer-tabs">
          <button
            type="button"
            className={`drawer-tab ${activeTab === "queue" ? "active" : ""}`}
            data-testid="tab-queue"
            onClick={() => setActiveTab("queue")}
          >
            <ListOrdered size={13} />
            <span>Fila de Execução ({jobs.length})</span>
          </button>
          <button
            type="button"
            className={`drawer-tab ${activeTab === "metrics" ? "active" : ""}`}
            data-testid="tab-metrics"
            onClick={() => setActiveTab("metrics")}
          >
            <BarChart3 size={13} />
            <span>Métricas 48h & Séries</span>
          </button>
        </div>

        <div className="drawer-body">
          {activeTab === "queue" ? (
            <div className="drawer-section-stack">
              {/* 1. Enfileirar Vídeo Atual (1 vídeo por padrão) */}
              <div className="drawer-card">
                <div className="drawer-card-head">
                  <span className="drawer-card-title">
                    Enfileirar Vídeo Atual (
                    {project?.manifest.title || "Sem projeto"})
                  </span>
                  <span className="pill pill-gold">1 vídeo por padrão</span>
                </div>

                <div className="grid-2" style={{ alignItems: "end" }}>
                  <div>
                    <label className="field-label">Ação de Produção</label>
                    <select
                      className="select"
                      data-testid="select-queue-action"
                      aria-label="Ação de Produção"
                      value={currentAction}
                      onChange={(e) =>
                        setCurrentAction(e.target.value as QueueActionType)
                      }
                    >
                      <option value="run_pending">
                        run_pending — Executar Pendentes
                      </option>
                      <option value="render_preview">
                        render_preview — Render Preview (15fps)
                      </option>
                      <option value="render_final">
                        render_final — Render Final (30fps)
                      </option>
                    </select>
                  </div>

                  <button
                    type="button"
                    className="btn btn-primary"
                    data-testid="btn-enqueue-current"
                    disabled={!project || busyEnqueue}
                    onClick={() => void handleEnqueueCurrent()}
                  >
                    <Plus size={13} />
                    {busyEnqueue
                      ? "Enfileirando..."
                      : "+ Adicionar à Fila (1 vídeo)"}
                  </button>
                </div>
              </div>

              {/* 2. Adicionar Outro Episódio ao Lote (Opcional) */}
              <div className="drawer-card">
                <div className="drawer-card-head">
                  <span className="drawer-card-title">
                    Adicionar Outro Episódio ao Lote (Opcional)
                  </span>
                  <span className="pill">Sob Demanda</span>
                </div>

                <div className="grid-2">
                  <div>
                    <label className="field-label">Episódio</label>
                    <select
                      className="select"
                      data-testid="select-queue-batch-project"
                      aria-label="Selecionar episódio para lote"
                      value={batchSlug}
                      onChange={(e) => setBatchSlug(e.target.value)}
                    >
                      {projects.map((p) => (
                        <option key={p.slug} value={p.slug}>
                          {p.title} ({p.slug})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="field-label">Ação</label>
                    <select
                      className="select"
                      aria-label="Ação para o episódio do lote"
                      value={batchAction}
                      onChange={(e) =>
                        setBatchAction(e.target.value as QueueActionType)
                      }
                    >
                      <option value="run_pending">Executar Pendentes</option>
                      <option value="render_preview">Render Preview</option>
                      <option value="render_final">Render Final</option>
                    </select>
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-sm"
                  data-testid="btn-enqueue-batch"
                  disabled={!batchSlug || busyEnqueue}
                  onClick={() => void handleEnqueueBatch()}
                >
                  <Plus size={12} /> + Enfileirar Episódio
                </button>
              </div>

              {/* 3. Lista de Jobs da Fila */}
              <div className="drawer-card">
                <div className="drawer-card-head">
                  <span className="drawer-card-title">
                    Fila FIFO & Histórico ({jobs.length})
                  </span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      className="btn btn-xs"
                      onClick={() => void onRefreshQueue()}
                      title="Atualizar estado da fila"
                    >
                      <RefreshCw size={11} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-xs"
                      data-testid="btn-clear-queue"
                      disabled={busyClearQueue || jobs.length === 0}
                      onClick={() => void onClearHistory()}
                    >
                      <Trash2 size={11} /> Limpar Histórico
                    </button>
                  </div>
                </div>

                {jobs.length === 0 ? (
                  <div className="queue-empty-box">
                    Nenhum job na fila no momento. Adicione o vídeo atual acima
                    para execução controlada.
                  </div>
                ) : (
                  <div className="queue-jobs-list" data-testid="queue-jobs-list">
                    {jobs.map((job) => (
                      <div
                        key={job.job_id}
                        className={`queue-job-item status-${job.status}`}
                        data-testid={`queue-job-${job.job_id}`}
                      >
                        <div className="queue-job-top">
                          <div className="queue-job-title-wrap">
                            <strong className="queue-job-title">
                              {job.title || job.slug}
                            </strong>
                            <span className="mono queue-job-slug">
                              {job.slug} · {job.job_id}
                            </span>
                          </div>
                          <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                            <span className="pill">
                              {ACTION_LABELS[job.action] || job.action}
                            </span>
                            <span
                              className={`pill ${statusBadgeClass(job.status)}`}
                            >
                              {job.status === "running" && <Play size={10} />}
                              {job.status === "queued" && <Clock size={10} />}
                              {job.status === "completed" && (
                                <CheckCircle2 size={10} />
                              )}
                              {job.status}
                            </span>
                          </div>
                        </div>

                        {(job.message || job.error) && (
                          <div
                            className={`queue-job-msg ${
                              job.error ? "is-error" : ""
                            }`}
                          >
                            {job.error || job.message}
                          </div>
                        )}

                        {job.status === "queued" && (
                          <div className="queue-job-actions">
                            <button
                              type="button"
                              className="btn btn-danger btn-xs"
                              data-testid={`btn-cancel-job-${job.job_id}`}
                              onClick={() => void onCancelJob(job.job_id)}
                            >
                              <XCircle size={11} /> Cancelar
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="drawer-section-stack">
              {/* Aba 2: Formulário de Métricas 48h do Vídeo Atual */}
              <form
                className="drawer-card"
                onSubmit={(e) => void handleSaveMetricsSubmit(e)}
              >
                <div className="drawer-card-head">
                  <span className="drawer-card-title">
                    Métricas Reais 48h ·{" "}
                    {project?.manifest.title || "Vídeo Atual"}
                  </span>
                  <span className="pill pill-blue">
                    {project?.manifest.series.format_type || "perdido_traducao"}
                  </span>
                </div>

                <div className="grid-3">
                  <div>
                    <label className="field-label">
                      Viewed vs. Swiped (%)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      className="input mono"
                      data-testid="input-metric-swiped"
                      placeholder="Ex.: 78.5"
                      value={swipedPct}
                      onChange={(e) => setSwipedPct(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="field-label">Retenção Média (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="200"
                      className="input mono"
                      data-testid="input-metric-retention"
                      placeholder="Ex.: 92.4"
                      value={retentionPct}
                      onChange={(e) => setRetentionPct(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="field-label">Comentários (48h)</label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      className="input mono"
                      data-testid="input-metric-comments"
                      placeholder="Ex.: 47"
                      value={commentsCount}
                      onChange={(e) => setCommentsCount(e.target.value)}
                    />
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    marginTop: 4,
                  }}
                >
                  <span
                    className="mono"
                    style={{ fontSize: 10.5, color: "var(--text-muted)" }}
                  >
                    Alimenta o recomendador de Formato-Série do canal
                  </span>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    data-testid="btn-save-metrics"
                    disabled={!project || busySaveMetrics}
                  >
                    <Save size={13} />
                    {busySaveMetrics ? "Salvando..." : "Salvar Métricas 48h"}
                  </button>
                </div>
              </form>

              {/* Painel Performance por Formato-Série (@pastorandrebezerra) */}
              <div
                className="drawer-card"
                data-testid="series-analytics-panel"
              >
                <div className="drawer-card-head">
                  <span className="drawer-card-title">
                    Performance por Formato-Série (@pastorandrebezerra)
                  </span>
                  {seriesAnalytics?.top_performing_format && (
                    <span
                      className="pill pill-gold"
                      data-testid="top-performing-format-badge"
                    >
                      ★ Top: {seriesAnalytics.top_performing_format}
                    </span>
                  )}
                </div>

                {seriesAnalytics?.recommendation_note && (
                  <div
                    className="series-recommendation-box"
                    data-testid="series-recommendation-note"
                  >
                    <Sparkles size={14} color="#E5A93C" />
                    <span>{seriesAnalytics.recommendation_note}</span>
                  </div>
                )}

                <div className="series-cards-grid">
                  {(seriesAnalytics?.series || []).map((item) => {
                    const isTop =
                      seriesAnalytics?.top_performing_format ===
                      item.format_type;
                    return (
                      <div
                        key={item.format_type}
                        className={`series-metric-card ${
                          isTop ? "is-top" : ""
                        }`}
                        data-testid={`series-card-${item.format_type}`}
                      >
                        <div className="series-metric-head">
                          <strong>
                            {FORMAT_LABELS[item.format_type] ||
                              item.label ||
                              item.format_type}
                          </strong>
                          <span className="pill">
                            {item.published_episodes}/{item.total_episodes} ep.
                          </span>
                        </div>

                        <div className="series-metric-kpis">
                          <div className="series-kpi">
                            <span className="series-kpi-k">Viewed/Swiped</span>
                            <strong className="series-kpi-v mono">
                              {item.avg_viewed_vs_swiped_pct !== null &&
                              item.avg_viewed_vs_swiped_pct !== undefined
                                ? `${item.avg_viewed_vs_swiped_pct.toFixed(1)}%`
                                : "—"}
                            </strong>
                          </div>
                          <div className="series-kpi">
                            <span className="series-kpi-k">Retenção</span>
                            <strong className="series-kpi-v mono">
                              {item.avg_retention_pct !== null &&
                              item.avg_retention_pct !== undefined
                                ? `${item.avg_retention_pct.toFixed(1)}%`
                                : "—"}
                            </strong>
                          </div>
                          <div className="series-kpi">
                            <span className="series-kpi-k">Comentários</span>
                            <strong className="series-kpi-v mono">
                              {item.total_comments ?? 0}
                            </strong>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
