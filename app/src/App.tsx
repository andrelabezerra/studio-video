// app/src/App.tsx
import { useCallback, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useStudioProject } from "./hooks/useStudioProject";
import { useStudioHotkeys } from "./hooks/useStudioHotkeys";
import { TopBar } from "./components/TopBar";
import { CanvasFlow } from "./components/CanvasFlow";
import { ScenePreviewModal } from "./components/ScenePreviewModal";
import {
  NewProjectModal,
  type NewProjectModalMode,
} from "./components/NewProjectModal";
import { QueueAndMetricsDrawer } from "./components/QueueAndMetricsDrawer";
import { ToastBanner } from "./components/ToastBanner";

export function App() {
  const studio = useStudioProject();
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [newModalMode, setNewModalMode] =
    useState<NewProjectModalMode>("scratch");
  const [queueDrawerOpen, setQueueDrawerOpen] = useState(false);
  const [previewSceneId, setPreviewSceneId] = useState<string | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [centerSignal, setCenterSignal] = useState(0);

  const togglePreviewPlayRef = useRef<(() => void) | null>(null);

  const previewScene = useMemo(() => {
    if (!previewSceneId || !studio.project) return null;
    return (
      studio.project.scenes.find((s) => s.scene_id === previewSceneId) || null
    );
  }, [previewSceneId, studio.project]);

  const pendingCount = studio.project?.pipeline_status?.pending_count ?? 0;

  const queueJobsCount = studio.queueState.jobs.length;
  const queueActiveCount = useMemo(
    () =>
      studio.queueState.jobs.filter(
        (j) => j.status === "queued" || j.status === "running"
      ).length,
    [studio.queueState.jobs]
  );

  const handleCopyText = useCallback(
    (label: string, text: string) => {
      if (
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        navigator.clipboard
          .writeText(text)
          .then(() =>
            studio.pushToast(
              "info",
              `${label} copiado para a área de transferência.`
            )
          )
          .catch(() =>
            studio.pushToast(
              "warning",
              `Não foi possível copiar ${label} automaticamente.`
            )
          );
      } else {
        studio.pushToast("info", `${label} pronto para cópia.`);
      }
    },
    [studio]
  );

  const handleApproveScene = useCallback(
    async (sceneId: string) => {
      await studio.updateScene(sceneId, { status: "approved" });
    },
    [studio]
  );

  const handleRunPending = useCallback(() => {
    void studio.runPending("preview");
  }, [studio]);

  const handleRegenerateSceneHotkey = useCallback(
    (sceneId: string) => {
      void studio.regenerateScene(sceneId, "preview");
    },
    [studio]
  );

  const handleApproveSceneHotkey = useCallback(
    (sceneId: string) => {
      void handleApproveScene(sceneId);
    },
    [handleApproveScene]
  );

  const handleRegisterTogglePlay = useCallback(
    (fn: (() => void) | null) => {
      togglePreviewPlayRef.current = fn;
    },
    []
  );

  const handleTogglePreviewPlay = useCallback(() => {
    togglePreviewPlayRef.current?.();
  }, []);

  const handleCloseActiveModal = useCallback(() => {
    if (newModalOpen) {
      setNewModalOpen(false);
    } else if (previewSceneId) {
      setPreviewSceneId(null);
    } else if (queueDrawerOpen) {
      setQueueDrawerOpen(false);
    }
  }, [newModalOpen, previewSceneId, queueDrawerOpen]);

  const activeSceneIdForHotkeys = previewSceneId ?? selectedSceneId;
  const canRunPending = Boolean(
    studio.project &&
      pendingCount > 0 &&
      !studio.busyMap.run_pending &&
      !studio.renderProgress.active
  );

  useStudioHotkeys({
    canRunPending,
    activeSceneId: activeSceneIdForHotkeys,
    isPreviewModalOpen: Boolean(studio.project && previewScene),
    isNewModalOpen: newModalOpen || queueDrawerOpen,
    onRunPending: handleRunPending,
    onApproveScene: handleApproveSceneHotkey,
    onRegenerateScene: handleRegenerateSceneHotkey,
    onTogglePreviewPlay: handleTogglePreviewPlay,
    onCloseModal: handleCloseActiveModal,
  });

  return (
    <div className="studio-shell">
      <TopBar
        projects={studio.projects}
        activeSlug={studio.activeSlug}
        project={studio.project}
        sseStatus={studio.sseStatus}
        pendingCount={pendingCount}
        busyRunPending={Boolean(studio.busyMap.run_pending)}
        renderActive={studio.renderProgress.active}
        queueJobsCount={queueJobsCount}
        queueActiveCount={queueActiveCount}
        onSelectProject={(slug) => {
          setPreviewSceneId(null);
          setSelectedSceneId(null);
          void studio.loadProject(slug);
        }}
        onOpenNewProject={() => {
          setNewModalMode("scratch");
          setNewModalOpen(true);
        }}
        onOpenCloneWorkflow={() => {
          setNewModalMode("clone");
          setNewModalOpen(true);
        }}
        onRunPending={handleRunPending}
        onOpenQueueDrawer={() => setQueueDrawerOpen(true)}
        onCenterCanvas={() => setCenterSignal((n) => n + 1)}
      />

      {studio.loading && !studio.project ? (
        <div className="empty-state">
          <div className="mono" style={{ color: "var(--vox-gold)" }}>
            Carregando Cockpit Studio Video...
          </div>
        </div>
      ) : !studio.project ? (
        <div className="empty-state">
          <p>Nenhum projeto carregado ainda.</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setNewModalMode("scratch");
              setNewModalOpen(true);
            }}
          >
            <Plus size={14} /> Criar Primeiro Vídeo
          </button>
        </div>
      ) : (
        <CanvasFlow
          project={studio.project}
          busyMap={studio.busyMap}
          renderProgress={studio.renderProgress}
          mediaRevision={studio.mediaRevision}
          audioCapabilities={studio.audioCapabilities}
          ttsPreview={studio.ttsPreview}
          centerSignal={centerSignal}
          selectedSceneId={selectedSceneId}
          onSelectScene={setSelectedSceneId}
          onRecommendBriefing={studio.recommendBriefing}
          onSaveBriefing={studio.saveBriefing}
          onGenerateScript={() => studio.generateScript(false)}
          onSaveScript={studio.saveScript}
          onRefineScript={studio.refineScript}
          onApproveGate1={studio.approveGate1}
          onUploadAudio={studio.uploadAudio}
          onAlignAudio={studio.alignAudio}
          onUploadVoiceSample={studio.uploadVoiceSample}
          onDeleteVoiceSample={studio.deleteVoiceSample}
          onPreviewTts={studio.previewTtsText}
          onGenerateTts={studio.generateTtsAudio}
          onOpenScenePreview={(id) => {
            setSelectedSceneId(id);
            setPreviewSceneId(id);
          }}
          onRegenerateScene={(id) => studio.regenerateScene(id, "preview")}
          onApproveScene={handleApproveScene}
          onUploadSceneAsset={(id, file, assetId) =>
            studio.uploadSceneAsset(id, file, { asset_id: assetId })
          }
          onStartRender={(profile) => studio.startRender(profile, false)}
          onGenerateCover={studio.generateCover}
          onCopyText={handleCopyText}
        />
      )}

      {studio.project && previewScene && (
        <ScenePreviewModal
          project={studio.project}
          scene={previewScene}
          templates={studio.templates}
          tier2Catalog={studio.tier2Catalog}
          projectAssets={studio.projectAssets}
          mediaRevision={studio.mediaRevision}
          busySave={Boolean(
            studio.busyMap[`scene_save_${previewScene.scene_id}`]
          )}
          busyRegen={Boolean(
            studio.busyMap[`scene_regen_${previewScene.scene_id}`]
          )}
          busyAsset={Boolean(
            studio.busyMap[`scene_asset_${previewScene.scene_id}`]
          )}
          busyPin={Boolean(
            studio.busyMap[`scene_pin_${previewScene.scene_id}`]
          )}
          busyTier2={Boolean(
            studio.busyMap[`scene_tier2_${previewScene.scene_id}`]
          )}
          onClose={() => setPreviewSceneId(null)}
          onNavigateScene={(nextSceneId) => {
            setSelectedSceneId(nextSceneId);
            setPreviewSceneId(nextSceneId);
          }}
          onSaveScene={studio.updateScene}
          onRegenerateScene={studio.regenerateScene}
          onUploadAsset={(id, file, options) =>
            studio.uploadSceneAsset(id, file, options)
          }
          onAttachAsset={(id, payload) => studio.attachSceneAsset(id, payload)}
          onDeleteAsset={(id, assetId) => studio.deleteSceneAsset(id, assetId)}
          onAddPin={studio.addScenePin}
          onTogglePin={studio.toggleScenePin}
          onDeletePin={studio.deleteScenePin}
          onGenerateTier2={studio.generateTier2Scene}
          onCopyPrompt={(prompt) =>
            handleCopyText(
              `Prompt ${previewScene.scene_id.toUpperCase()}`,
              prompt
            )
          }
          onRegisterTogglePlay={handleRegisterTogglePlay}
        />
      )}

      <NewProjectModal
        open={newModalOpen}
        initialMode={newModalMode}
        sourceProject={studio.project}
        busy={Boolean(
          studio.busyMap.create_project || studio.busyMap.clone_workflow
        )}
        onClose={() => setNewModalOpen(false)}
        onSubmitCreate={async (payload) => {
          setPreviewSceneId(null);
          setSelectedSceneId(null);
          await studio.createNewProject(payload);
        }}
        onSubmitClone={async (sourceSlug, payload) => {
          setPreviewSceneId(null);
          setSelectedSceneId(null);
          await studio.cloneWorkflow(sourceSlug, payload);
        }}
      />

      <QueueAndMetricsDrawer
        open={queueDrawerOpen}
        project={studio.project}
        projects={studio.projects}
        queueState={studio.queueState}
        seriesAnalytics={studio.seriesAnalytics}
        busyEnqueue={Boolean(studio.busyMap.queue_enqueue)}
        busyClearQueue={Boolean(studio.busyMap.queue_clear)}
        busySaveMetrics={Boolean(studio.busyMap.metrics_save)}
        onClose={() => setQueueDrawerOpen(false)}
        onEnqueueJob={studio.enqueueJob}
        onCancelJob={studio.cancelQueueJob}
        onClearHistory={studio.clearQueueHistory}
        onRefreshQueue={studio.refreshQueue}
        onSaveMetrics={studio.saveProjectMetrics}
        onRefreshAnalytics={studio.refreshSeriesAnalytics}
      />

      <ToastBanner toasts={studio.toasts} onDismiss={studio.dismissToast} />
    </div>
  );
}

export default App;
