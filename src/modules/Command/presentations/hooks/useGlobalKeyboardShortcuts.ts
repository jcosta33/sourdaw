import { useEffect } from "react";
import { togglePlayback, stopPlayback, toggleLoop, toggleMetronome, toggleRecording } from "#/modules/Transport/useCases/transportControls";
import { undo, redo } from "../../useCases/undoRedo";
import { setEditingTool } from "#/modules/Workspace/useCases/setEditingTool";
import { TOOL_SHORTCUTS } from "#/modules/Workspace/models/EditingTool";
import { workspaceStore } from "#/modules/Workspace/stores/workspaceStore";

export const useGlobalKeyboardShortcuts = (): void => {
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

            if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                const ws = workspaceStore.value;
                if (ws) {
                    workspaceStore.set({ ...ws, commandPaletteOpen: !ws.commandPaletteOpen });
                }
                return;
            }

            if (e.key === "z" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (e.shiftKey) {
                    void redo();
                } else {
                    void undo();
                }
                return;
            }

            if (isInput) return;

            switch (e.key) {
                case " ":
                    e.preventDefault();
                    togglePlayback();
                    break;
                case "Escape":
                    stopPlayback();
                    break;
                case "l":
                    toggleLoop();
                    break;
                case "m":
                    toggleMetronome();
                    break;
                case "r":
                    toggleRecording();
                    break;
                default: {
                    const tool = TOOL_SHORTCUTS[e.key];
                    if (tool) {
                        setEditingTool(tool);
                    }
                    break;
                }
            }
        };

        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, []);
};
