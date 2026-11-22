// app/src/hooks/useStudioHotkeys.ts
import { useEffect } from "react";

export interface StudioHotkeysOptions {
  canRunPending: boolean;
  activeSceneId: string | null;
  isPreviewModalOpen: boolean;
  isNewModalOpen: boolean;
  onRunPending: () => void;
  onApproveScene: (sceneId: string) => void;
  onRegenerateScene: (sceneId: string) => void;
  onTogglePreviewPlay: () => void;
  onCloseModal: () => void;
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  if (target.isContentEditable) {
    return true;
  }
  return Boolean(target.closest('[contenteditable="true"]'));
}

export function useStudioHotkeys(options: StudioHotkeysOptions) {
  const {
    canRunPending,
    activeSceneId,
    isPreviewModalOpen,
    isNewModalOpen,
    onRunPending,
    onApproveScene,
    onRegenerateScene,
    onTogglePreviewPlay,
    onCloseModal,
  } = options;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;

      // Esc fecha modal ativo (Preview ou Novo Projeto)
      if (event.key === "Escape") {
        if (isPreviewModalOpen || isNewModalOpen) {
          event.preventDefault();
          onCloseModal();
        }
        return;
      }

      // Ctrl+Enter / Cmd+Enter dispara Executar Pendentes
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        if (canRunPending && !isNewModalOpen) {
          event.preventDefault();
          onRunPending();
        }
        return;
      }

      // Ignorar atalhos de tecla simples quando modificadores estiverem pressionados
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      // Ignorar A, R e Espaço dentro de campos editáveis
      if (isEditableElement(event.target)) {
        return;
      }

      // Espaço: Play/Pause no ScenePreviewModal
      if (event.code === "Space" || event.key === " ") {
        if (isPreviewModalOpen) {
          event.preventDefault();
          onTogglePreviewPlay();
        }
        return;
      }

      // Bloquear A e R quando modal de novo vídeo estiver aberto
      if (isNewModalOpen || !activeSceneId) {
        return;
      }

      const lower = event.key.toLowerCase();
      if (lower === "a") {
        event.preventDefault();
        onApproveScene(activeSceneId);
        return;
      }

      if (lower === "r") {
        event.preventDefault();
        onRegenerateScene(activeSceneId);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    canRunPending,
    activeSceneId,
    isPreviewModalOpen,
    isNewModalOpen,
    onRunPending,
    onApproveScene,
    onRegenerateScene,
    onTogglePreviewPlay,
    onCloseModal,
  ]);
}
