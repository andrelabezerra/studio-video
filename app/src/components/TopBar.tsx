// app/src/components/TopBar.tsx
import {
  BarChart3,
  CheckCircle2,
  Clapperboard,
  CopyPlus,
  Crosshair,
  DollarSign,
  Plus,
  Radio,
  Zap,
} from "lucide-react";
import type { ProjectDetail, ProjectSummary } from "../types/studio";

interface TopBarProps {
  projects: ProjectSummary[];
  activeSlug: string | null;
  project: ProjectDetail | null;
  sseStatus: "connecting" | "live" | "reconnecting" | "offline";
  pendingCount: number;
  busyRunPending: boolean;
  renderActive: boolean;
  queueJobsCount: number;
  queueActiveCount: number;
  onSelectProject: (slug: string) => void;
  onOpenNewProject: () => void;
  onOpenCloneWorkflow: () => void;
  onRunPending: () => void;
  onOpenQueueDrawer: () => void;
  onCenterCanvas: () => void;
}

const SSE_LABELS: Record<TopBarProps["sseStatus"], string> = {
  live: "SSE Ao Vivo",
  connecting: "Conectando SSE",
  reconnecting: "Reconectando...",
  offline: "SSE Offline",
};

export function TopBar({
  projects,
  activeSlug,
  project,
  sseStatus,
  pendingCount,
  busyRunPending,
  renderActive,
  queueJobsCount,
  queueActiveCount,
  onSelectProject,
  onOpenNewProject,
  onOpenCloneWorkflow,
  onRunPending,
  onOpenQueueDrawer,
  onCenterCanvas,
}: TopBarProps) {
  const spent = project?.manifest.cost_ledger.spent_total ?? 0;
  const cap = project?.manifest.cost_ledger.cap_usd ?? 2.5;
  const handle = project?.preset.channel_handle || "@pastorandrebezerra";
  const hasPending = pendingCount > 0;
  const isRunning = busyRunPending || renderActive;

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand-mark">
          <div className="brand-icon" aria-hidden="true">
            <Clapperboard size={16} />
          </div>
          <div className="brand-text">
            <span className="brand-title">Studio Video</span>
            <span className="brand-handle">{handle}</span>
          </div>
        </div>

        <select
          className="project-select"
          aria-label="Selecionar projeto"
          value={activeSlug || ""}
          onChange={(e) => {
            if (e.target.value) onSelectProject(e.target.value);
          }}
        >
          {projects.length === 0 && (
            <option value="">Nenhum projeto encontrado</option>
          )}
          {projects.map((item) => (
            <option key={item.slug} value={item.slug}>
              {item.title} ({item.slug})
            </option>
          ))}
        </select>

        <button
          type="button"
          className="btn btn-primary"
          data-testid="btn-new-video"
          onClick={onOpenNewProject}
        >
          <Plus size={14} />
          Novo Vídeo
        </button>

        <button
          type="button"
          className="btn"
          data-testid="btn-clone-workflow"
          disabled={!project}
          onClick={onOpenCloneWorkflow}
          title="Criar 1 novo episódio herdando série, tradução, duração e estilo deste workflow"
        >
          <CopyPlus size={14} color="#E5A93C" />
          Clonar Estilo
        </button>
      </div>

      <div className="topbar-right">
        <button
          type="button"
          className={`btn ${hasPending ? "btn-stale" : "btn-up-to-date"}`}
          data-testid="btn-run-pending"
          disabled={!project || !hasPending || isRunning}
          onClick={onRunPending}
          title={
            hasPending
              ? `Executar ${pendingCount} etapa(s) pendente(s) (Atalho: Ctrl+Enter)`
              : "Tudo em dia (Atalho: Ctrl+Enter)"
          }
        >
          {hasPending ? <Zap size={13} /> : <CheckCircle2 size={13} />}
          {isRunning
            ? "Executando..."
            : hasPending
              ? `Executar Pendentes (${pendingCount})`
              : "Tudo em dia"}
        </button>

        <button
          type="button"
          className="btn"
          data-testid="btn-open-queue-drawer"
          onClick={onOpenQueueDrawer}
          title="Abrir Fila de Execução (1 vídeo por padrão) e Loop de Métricas 48h por Série"
        >
          <BarChart3 size={13} color="#E5A93C" />
          <span>Fila & Métricas</span>
          {queueJobsCount > 0 && (
            <span
              className={`topbar-badge ${queueActiveCount > 0 ? "active" : ""}`}
              data-testid="queue-badge-count"
            >
              {queueActiveCount > 0 ? queueActiveCount : queueJobsCount}
            </span>
          )}
        </button>

        <div
          className="metric-pill"
          title="Custo gasto acumulado vs. teto máximo por vídeo"
        >
          <DollarSign size={12} color="#E5A93C" />
          <span>Custo</span>
          <strong>
            ${spent.toFixed(2)} / ${cap.toFixed(2)}
          </strong>
        </div>

        <div className="metric-pill" title="Conexão Server-Sent Events em tempo real">
          <span className={`sse-dot ${sseStatus}`} />
          <Radio size={12} />
          <span>{SSE_LABELS[sseStatus]}</span>
        </div>

        <button
          type="button"
          className="btn"
          onClick={onCenterCanvas}
          title="Enquadrar todos os nós no canvas"
        >
          <Crosshair size={14} />
          Centralizar
        </button>
      </div>
    </header>
  );
}
