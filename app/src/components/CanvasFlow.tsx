// app/src/components/CanvasFlow.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Keyboard, Maximize2, Minimize2 } from "lucide-react";

import type {
  AudioCapabilities,
  Briefing,
  GenerateTtsPayload,
  ProjectDetail,
  ScriptData,
  TtsPreviewResponse,
  VoiceSampleInfo,
} from "../types/studio";
import type { RenderProgressState } from "../hooks/useStudioProject";
import { BriefingNode } from "./nodes/BriefingNode";
import { ScriptNode } from "./nodes/ScriptNode";
import { AudioNode } from "./nodes/AudioNode";
import { SceneNode } from "./nodes/SceneNode";
import { ScenesGroupNode } from "./nodes/ScenesGroupNode";
import { RenderNode } from "./nodes/RenderNode";

const NODE_TYPES = {
  briefing: BriefingNode,
  script: ScriptNode,
  audio: AudioNode,
  scene: SceneNode,
  scenesGroup: ScenesGroupNode,
  render: RenderNode,
};

type SceneFilterMode = "all" | "pending" | "approved";

interface CanvasFlowProps {
  project: ProjectDetail;
  busyMap: Record<string, boolean>;
  renderProgress: RenderProgressState;
  mediaRevision: number;
  audioCapabilities: AudioCapabilities | null;
  ttsPreview: TtsPreviewResponse | null;
  centerSignal: number;
  selectedSceneId: string | null;
  onSelectScene: (sceneId: string | null) => void;
  onRecommendBriefing: (rawIdea: string, seedRef: string | null) => Promise<void>;
  onSaveBriefing: (next: Briefing) => Promise<void>;
  onGenerateScript: () => Promise<void>;
  onSaveScript: (next: ScriptData, silent?: boolean) => Promise<void>;
  onRefineScript: (
    instruction: string,
    target: "hooks" | "segments" | "distribution"
  ) => Promise<void>;
  onApproveGate1: () => Promise<unknown>;
  onUploadAudio: (file: File) => Promise<void>;
  onAlignAudio: (source?: "recorded" | "pilot") => Promise<void>;
  onUploadVoiceSample: (file: File, name?: string) => Promise<VoiceSampleInfo | null>;
  onDeleteVoiceSample: (sampleId: string) => Promise<boolean>;
  onPreviewTts: () => Promise<TtsPreviewResponse | null>;
  onGenerateTts: (payload: GenerateTtsPayload) => Promise<unknown>;
  onOpenScenePreview: (sceneId: string) => void;
  onRegenerateScene: (sceneId: string) => Promise<unknown>;
  onApproveScene: (sceneId: string) => Promise<unknown>;
  onUploadSceneAsset: (
    sceneId: string,
    file: File,
    assetId?: string
  ) => Promise<unknown>;
  onStartRender: (profile: "preview" | "final") => Promise<unknown>;
  onGenerateCover: () => Promise<unknown>;
  onCopyText: (label: string, text: string) => void;
}

function edgeStyle(status: "done" | "active" | "pending" | "stale") {
  const color =
    status === "stale"
      ? "#F97316"
      : status === "done"
        ? "#34D399"
        : status === "active"
          ? "#E5A93C"
          : "#4B5563";
  return {
    animated: status === "active" || status === "stale",
    style: { stroke: color, strokeWidth: status === "pending" ? 1.5 : 2 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color,
      width: 16,
      height: 16,
    },
  };
}

function CanvasInner(props: CanvasFlowProps) {
  const {
    project,
    busyMap,
    renderProgress,
    mediaRevision,
    audioCapabilities,
    ttsPreview,
    centerSignal,
    selectedSceneId,
    onSelectScene,
  } = props;
  const { fitView } = useReactFlow();
  const prevKeyRef = useRef<string>("");

  const [scenesCollapsed, setScenesCollapsed] = useState(false);
  const [sceneFilter, setSceneFilter] = useState<SceneFilterMode>("all");

  // Reset filtro ao trocar de projeto
  useEffect(() => {
    setSceneFilter("all");
  }, [project.manifest.slug]);

  const sortedScenes = useMemo(
    () => [...project.scenes].sort((a, b) => a.order - b.order),
    [project.scenes]
  );

  const sceneRuntime = project.scene_runtime || {};
  const pipelineStatus = project.pipeline_status;

  const sceneStats = useMemo(() => {
    const total = sortedScenes.length;
    let approved = 0;
    let stale = 0;
    let pending = 0;
    for (const sc of sortedScenes) {
      const isApproved = sc.status === "approved" || sc.status === "rendered";
      const isStale = Boolean(sceneRuntime[sc.scene_id]?.is_stale);
      if (isApproved) approved += 1;
      if (isStale) stale += 1;
      if (!isApproved || isStale) pending += 1;
    }
    return { total, approved, stale, pending };
  }, [sortedScenes, sceneRuntime]);

  const visibleScenes = useMemo(() => {
    if (sceneFilter === "all") return sortedScenes;
    if (sceneFilter === "approved") {
      return sortedScenes.filter(
        (sc) => sc.status === "approved" || sc.status === "rendered"
      );
    }
    // "pending": cenas não aprovadas ou marcadas como stale
    return sortedScenes.filter((sc) => {
      const isApproved = sc.status === "approved" || sc.status === "rendered";
      const isStale = Boolean(sceneRuntime[sc.scene_id]?.is_stale);
      return !isApproved || isStale;
    });
  }, [sortedScenes, sceneFilter, sceneRuntime]);

  const { nodes, edges } = useMemo(() => {
    const gates = project.manifest.gates;
    const audioStale = Boolean(pipelineStatus?.audio_stale);
    const renderStale = Boolean(pipelineStatus?.render_stale);

    const builtNodes: Node[] = [
      {
        id: "briefing",
        type: "briefing",
        position: { x: 40, y: 40 },
        dragHandle: ".node-header",
        data: {
          briefing: project.briefing,
          formats: project.preset.formats_series || [],
          approved: gates.briefing_approved,
          busyRecommend: Boolean(busyMap.briefing_recommend),
          busySave: Boolean(busyMap.briefing_save),
          busyGenerate: Boolean(busyMap.script_generate),
          onRecommend: props.onRecommendBriefing,
          onSave: props.onSaveBriefing,
          onGenerateScript: props.onGenerateScript,
        },
      },
      {
        id: "script",
        type: "script",
        position: { x: 490, y: 40 },
        dragHandle: ".node-header",
        data: {
          script: project.script,
          gate1Approved: gates.script_gate_1_approved,
          busyRefine: Boolean(busyMap.script_refine),
          busySave: Boolean(busyMap.script_save),
          busyApprove: Boolean(busyMap.script_approve),
          onSaveScript: props.onSaveScript,
          onRefineScript: props.onRefineScript,
          onApproveGate1: async () => {
            await props.onApproveGate1();
          },
        },
      },
      {
        id: "audio",
        type: "audio",
        position: { x: 1005, y: 40 },
        dragHandle: ".node-header",
        data: {
          alignment: project.audio_alignment,
          hasAudio: project.artifacts.has_audio,
          audioUrl: project.artifacts.audio_url,
          mediaRevision,
          alignedGate: gates.audio_aligned,
          isStale: audioStale,
          canAlign: Boolean(project.script),
          busyUpload: Boolean(busyMap.audio_upload),
          busyAlign: Boolean(busyMap.audio_align),
          busySampleUpload: Boolean(busyMap.voice_sample_upload),
          busySampleDelete: Boolean(busyMap.voice_sample_delete),
          busyPreviewTts: Boolean(busyMap.tts_preview),
          busyGenerateTts: Boolean(busyMap.tts_generate),
          audioCapabilities,
          ttsPreview,
          renderProgress,
          onUploadAudio: props.onUploadAudio,
          onAlignAudio: props.onAlignAudio,
          onUploadVoiceSample: props.onUploadVoiceSample,
          onDeleteVoiceSample: props.onDeleteVoiceSample,
          onPreviewTts: props.onPreviewTts,
          onGenerateTts: props.onGenerateTts,
          onCopyText: props.onCopyText,
        },
      },
    ];

    const sceneStartX = 1405;
    const colSpacing = 352;
    const rowSpacing = 430;
    let renderX = sceneStartX;

    if (sortedScenes.length > 0 && scenesCollapsed) {
      builtNodes.push({
        id: "scenes-group",
        type: "scenesGroup",
        position: { x: sceneStartX, y: 40 },
        dragHandle: ".node-header",
        data: {
          scenes: sortedScenes,
          sceneRuntime,
          mediaRevision,
          approvedCount: sceneStats.approved,
          pendingCount: sceneStats.pending,
          staleCount: sceneStats.stale,
          onExpand: () => setScenesCollapsed(false),
          onOpenPreview: props.onOpenScenePreview,
        },
      });
      renderX = sceneStartX + 385;
    } else if (visibleScenes.length > 0) {
      visibleScenes.forEach((scene, idx) => {
        const col = Math.floor(idx / 2);
        const row = idx % 2;
        const rt = sceneRuntime[scene.scene_id];
        builtNodes.push({
          id: scene.scene_id,
          type: "scene",
          position: {
            x: sceneStartX + col * colSpacing,
            y: 40 + row * rowSpacing,
          },
          dragHandle: ".node-header",
          data: {
            scene,
            isStale: Boolean(rt?.is_stale),
            thumbnailUrl: rt?.thumbnail_url ?? null,
            mediaRevision,
            isSelected: selectedSceneId === scene.scene_id,
            busyRegen: Boolean(busyMap[`scene_regen_${scene.scene_id}`]),
            busyAsset: Boolean(busyMap[`scene_asset_${scene.scene_id}`]),
            busyApprove: Boolean(busyMap[`scene_save_${scene.scene_id}`]),
            onSelectScene: (id: string) => onSelectScene(id),
            onOpenPreview: props.onOpenScenePreview,
            onRegenerate: async (id: string) => {
              await props.onRegenerateScene(id);
            },
            onApprove: async (id: string) => {
              await props.onApproveScene(id);
            },
            onUploadAsset: async (id: string, file: File, assetId?: string) => {
              await props.onUploadSceneAsset(id, file, assetId);
            },
            onCopyPrompt: (prompt: string) =>
              props.onCopyText(`Prompt ${scene.scene_id.toUpperCase()}`, prompt),
          },
        });
      });

      const totalCols = Math.ceil(visibleScenes.length / 2);
      renderX = sceneStartX + totalCols * colSpacing + 40;
    }

    builtNodes.push({
      id: "render",
      type: "render",
      position: { x: renderX, y: 40 },
      dragHandle: ".node-header",
      data: {
        gates,
        artifacts: project.artifacts,
        distributionPack: project.script?.distribution_pack || null,
        renderProgress,
        mediaRevision,
        isStale: renderStale,
        hasScenes: sortedScenes.length > 0,
        busyPreview: Boolean(busyMap.render_preview),
        busyFinal: Boolean(busyMap.render_final),
        busyCover: Boolean(busyMap.generate_cover),
        onStartRender: async (profile: "preview" | "final") => {
          await props.onStartRender(profile);
        },
        onGenerateCover: async () => {
          await props.onGenerateCover();
        },
        onCopyText: props.onCopyText,
      },
    });

    // Arestas com cor de status
    const builtEdges: Edge[] = [
      {
        id: "e-briefing-script",
        source: "briefing",
        target: "script",
        type: "smoothstep",
        ...edgeStyle(
          gates.briefing_approved && project.script
            ? "done"
            : project.briefing.raw_idea
              ? "active"
              : "pending"
        ),
      },
      {
        id: "e-script-audio",
        source: "script",
        target: "audio",
        type: "smoothstep",
        ...edgeStyle(
          audioStale
            ? "stale"
            : gates.script_gate_1_approved
              ? "done"
              : project.script
                ? "active"
                : "pending"
        ),
      },
    ];

    if (sortedScenes.length > 0 && scenesCollapsed) {
      builtEdges.push(
        {
          id: "e-audio-scenes-group",
          source: "audio",
          target: "scenes-group",
          type: "smoothstep",
          ...edgeStyle(
            audioStale
              ? "stale"
              : gates.audio_aligned
                ? "done"
                : "active"
          ),
        },
        {
          id: "e-scenes-group-render",
          source: "scenes-group",
          target: "render",
          type: "smoothstep",
          ...edgeStyle(
            sceneStats.stale > 0 || renderStale
              ? "stale"
              : sceneStats.approved === sortedScenes.length
                ? "done"
                : "pending"
          ),
        }
      );
    } else if (visibleScenes.length === 0) {
      builtEdges.push({
        id: "e-audio-render-empty",
        source: "audio",
        target: "render",
        type: "smoothstep",
        ...edgeStyle("pending"),
      });
    } else {
      // Liga Audio à 1ª coluna (row 0 e row 1)
      const col0Scenes = visibleScenes.slice(0, Math.min(2, visibleScenes.length));
      col0Scenes.forEach((sc) => {
        const scStale = Boolean(sceneRuntime[sc.scene_id]?.is_stale);
        builtEdges.push({
          id: `e-audio-${sc.scene_id}`,
          source: "audio",
          target: sc.scene_id,
          type: "smoothstep",
          ...edgeStyle(
            audioStale || scStale
              ? "stale"
              : gates.audio_aligned
                ? "done"
                : "active"
          ),
        });
      });

      // Encadeia coluna k -> coluna k+1 por linha (grade limpa sem cruzamento)
      for (let i = 0; i < visibleScenes.length; i++) {
        const current = visibleScenes[i];
        const nextInRow = visibleScenes[i + 2];
        const scStale = Boolean(sceneRuntime[current.scene_id]?.is_stale);
        const scDone =
          !scStale &&
          (current.status === "approved" || current.status === "rendered");
        if (nextInRow) {
          builtEdges.push({
            id: `e-${current.scene_id}-${nextInRow.scene_id}`,
            source: current.scene_id,
            target: nextInRow.scene_id,
            type: "smoothstep",
            ...edgeStyle(scStale ? "stale" : scDone ? "done" : "active"),
          });
        } else {
          builtEdges.push({
            id: `e-${current.scene_id}-render`,
            source: current.scene_id,
            target: "render",
            type: "smoothstep",
            ...edgeStyle(
              scStale || renderStale ? "stale" : scDone ? "done" : "pending"
            ),
          });
        }
      }
    }

    return { nodes: builtNodes, edges: builtEdges };
  }, [
    project,
    sortedScenes,
    visibleScenes,
    sceneRuntime,
    pipelineStatus,
    sceneStats,
    scenesCollapsed,
    selectedSceneId,
    onSelectScene,
    busyMap,
    renderProgress,
    mediaRevision,
    audioCapabilities,
    ttsPreview,
    props.onRecommendBriefing,
    props.onSaveBriefing,
    props.onGenerateScript,
    props.onSaveScript,
    props.onRefineScript,
    props.onApproveGate1,
    props.onUploadAudio,
    props.onAlignAudio,
    props.onUploadVoiceSample,
    props.onDeleteVoiceSample,
    props.onPreviewTts,
    props.onGenerateTts,
    props.onOpenScenePreview,
    props.onRegenerateScene,
    props.onApproveScene,
    props.onUploadSceneAsset,
    props.onStartRender,
    props.onGenerateCover,
    props.onCopyText,
  ]);

  // FitView automático quando trocar de projeto, quantidade de cenas, recolher ou filtrar
  useEffect(() => {
    const layoutKey = `${project.manifest.slug}:${sortedScenes.length}:${scenesCollapsed}:${sceneFilter}`;
    if (prevKeyRef.current !== layoutKey) {
      prevKeyRef.current = layoutKey;
      const timer = window.setTimeout(() => {
        void fitView({ padding: 0.12, duration: 300 });
      }, 60);
      return () => window.clearTimeout(timer);
    }
  }, [project.manifest.slug, sortedScenes.length, scenesCollapsed, sceneFilter, fitView]);

  useEffect(() => {
    if (centerSignal > 0) {
      void fitView({ padding: 0.12, duration: 300 });
    }
  }, [centerSignal, fitView]);

  const handleSelectFilter = (next: SceneFilterMode) => {
    setSceneFilter(next);
    if (scenesCollapsed) {
      setScenesCollapsed(false);
    }
  };

  return (
    <div className="canvas-wrapper">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.22}
        maxZoom={1.5}
        nodesConnectable={false}
        onPaneClick={() => onSelectScene(null)}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1.25}
          color="#1E2330"
        />

        {sortedScenes.length > 0 && (
          <Panel position="top-center" className="canvas-scene-toolbar-panel">
            <div className="canvas-scene-toolbar" data-testid="scenes-toolbar">
              <span className="scenes-toolbar-counter mono">
                Cenas 9:16 ·{" "}
                <strong>
                  {sceneStats.approved}/{sceneStats.total}
                </strong>{" "}
                aprovadas ·{" "}
                <strong
                  style={{
                    color:
                      sceneStats.stale > 0 ? "#fb923c" : "var(--text-secondary)",
                  }}
                >
                  {sceneStats.stale}
                </strong>{" "}
                desatualizadas
              </span>

              <div className="scene-filter-group" role="group" aria-label="Filtrar cenas">
                <button
                  type="button"
                  className={`scene-filter-btn ${
                    !scenesCollapsed && sceneFilter === "all" ? "active" : ""
                  }`}
                  data-testid="filter-scenes-all"
                  onClick={() => handleSelectFilter("all")}
                >
                  Todas
                </button>
                <button
                  type="button"
                  className={`scene-filter-btn ${
                    !scenesCollapsed && sceneFilter === "pending" ? "active" : ""
                  }`}
                  data-testid="filter-scenes-pending"
                  onClick={() => handleSelectFilter("pending")}
                >
                  Pendentes
                </button>
                <button
                  type="button"
                  className={`scene-filter-btn ${
                    !scenesCollapsed && sceneFilter === "approved" ? "active" : ""
                  }`}
                  data-testid="filter-scenes-approved"
                  onClick={() => handleSelectFilter("approved")}
                >
                  Aprovadas
                </button>
              </div>

              <button
                type="button"
                className="btn btn-xs"
                data-testid="btn-toggle-scenes-group"
                onClick={() => setScenesCollapsed((v) => !v)}
              >
                {scenesCollapsed ? (
                  <>
                    <Maximize2 size={12} />
                    Expandir Cenas
                  </>
                ) : (
                  <>
                    <Minimize2 size={12} />
                    Recolher Cenas
                  </>
                )}
              </button>
            </div>
          </Panel>
        )}

        <Controls showInteractive={false} />

        <Panel position="bottom-left" className="hotkeys-panel">
          <div className="hotkeys-pill" data-testid="hotkeys-legend">
            <Keyboard size={12} color="#E5A93C" />
            <span>
              <kbd>Ctrl+↵</kbd> Pendentes · <kbd>A</kbd> Aprovar ·{" "}
              <kbd>R</kbd> Regenerar · <kbd>Espaço</kbd> Play
            </span>
          </div>
        </Panel>

        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => {
            const nodeData = node.data as Record<string, unknown> | undefined;
            if (nodeData?.isStale) return "#F97316";
            if (node.type === "briefing") return "#3B82F6";
            if (node.type === "script") return "#E5A93C";
            if (node.type === "audio") return "#A855F7";
            if (node.type === "scenesGroup") {
              return Number(nodeData?.staleCount || 0) > 0 ? "#F97316" : "#E5A93C";
            }
            if (node.type === "render") return "#34D399";
            return "#64748B";
          }}
          maskColor="rgba(11, 13, 18, 0.72)"
        />
      </ReactFlow>
    </div>
  );
}

export function CanvasFlow(props: CanvasFlowProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
