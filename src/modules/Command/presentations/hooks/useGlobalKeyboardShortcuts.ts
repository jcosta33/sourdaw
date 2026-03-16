import { useEffect } from "react";
import { togglePlayback, stopPlayback, toggleLoop, toggleMetronome, toggleRecording, seekPlayhead } from "#/modules/Transport/useCases/transportControls";
import { clearSolos } from "#/modules/Track/useCases/toggleTrackState";
import { undo, redo } from "../../useCases/undoRedo";
import { setEditingTool } from "#/modules/Workspace/useCases/setEditingTool";
import { TOOL_SHORTCUTS } from "#/modules/Workspace/models/EditingTool";
import type { EditingTool } from "#/modules/Workspace/models/EditingTool";
import { workspaceStore } from "#/modules/Workspace/stores/workspaceStore";
import { transportStore } from "#/modules/Transport/stores/transportStore";
import { trackStore } from "#/modules/Track/stores/trackStore";
import { markerStore } from "#/modules/Timeline/stores/markerStore";
import { zoomTimeline } from "#/modules/Timeline/stores/timelineViewStore";
import { zoomToFit, zoomToSelection } from "#/modules/Workspace/useCases/togglePanel";
import { addTrack } from "#/modules/Track/useCases/addTrack";
import { duplicateTrack } from "#/modules/Track/useCases/duplicateTrack";
import { duplicateClip, duplicateClipToNextBar } from "#/modules/Track/useCases/clipUseCases";
import { zoomTracksVertical } from "#/modules/Track/useCases/trackZoom";

const ZOOM_STEP = 4;

const NUMBER_TOOL_MAP: Record<string, EditingTool> = {
    "1": "select",
    "2": "cut",
    "3": "draw",
    "4": "automation",
    "5": "stretch",
};

const getLastClipEndBeat = (): number => {
    const state = trackStore.value;
    if (!state) {
        return 0;
    }
    let maxEnd = 0;
    for (const track of state.tracks) {
        for (const clip of track.clips) {
            if (clip.endBeat > maxEnd) {
                maxEnd = clip.endBeat;
            }
        }
    }
    return maxEnd;
};

const getAllClipIds = (): string[] => {
    const state = trackStore.value;
    if (!state) {
        return [];
    }
    const ids: string[] = [];
    for (const track of state.tracks) {
        for (const clip of track.clips) {
            ids.push(clip.id);
        }
    }
    return ids;
};

const goToNextMarker = (): void => {
    const markers = markerStore.value?.markers;
    const playhead = transportStore.value?.playheadPosition ?? 0;
    if (!markers || markers.length === 0) {
        return;
    }
    const sorted = [...markers].sort((a, b) => a.beat - b.beat);
    const next = sorted.find((m) => m.beat > playhead);
    if (next) {
        seekPlayhead(next.beat);
    }
};

const goToPreviousMarker = (): void => {
    const markers = markerStore.value?.markers;
    const playhead = transportStore.value?.playheadPosition ?? 0;
    if (!markers || markers.length === 0) {
        return;
    }
    const sorted = [...markers].sort((a, b) => b.beat - a.beat);
    const prev = sorted.find((m) => m.beat < playhead);
    if (prev) {
        seekPlayhead(prev.beat);
    }
};

const toggleWorkspaceMode = (): void => {
    const ws = workspaceStore.value;
    if (!ws) {
        return;
    }
    const nextMode = ws.mode === "arrange" ? "clip" : "arrange";
    workspaceStore.set({ ...ws, mode: nextMode });
};

export const useGlobalKeyboardShortcuts = (): void => {
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
            const mod = e.metaKey || e.ctrlKey;

            if (e.key === "k" && mod) {
                e.preventDefault();
                const ws = workspaceStore.value;
                if (ws) {
                    workspaceStore.set({ ...ws, commandPaletteOpen: !ws.commandPaletteOpen });
                }
                return;
            }

            if (e.key.toLowerCase() === "z" && mod) {
                e.preventDefault();
                if (e.shiftKey) {
                    void redo();
                } else {
                    void undo();
                }
                return;
            }

            if (mod && e.key === "a" && !e.shiftKey) {
                if (isInput) {
                    return;
                }
                e.preventDefault();
                const ws = workspaceStore.value;
                if (ws) {
                    workspaceStore.set({ ...ws, selectedClipIds: getAllClipIds(), selectedClipId: null });
                }
                return;
            }

            if (mod && e.shiftKey && e.key.toLowerCase() === "a") {
                if (isInput) {
                    return;
                }
                e.preventDefault();
                const ws = workspaceStore.value;
                if (ws) {
                    workspaceStore.set({ ...ws, selectedClipIds: [], selectedClipId: null });
                }
                return;
            }

            if (mod && e.shiftKey && e.key.toLowerCase() === "d") {
                if (isInput) {
                    return;
                }
                e.preventDefault();
                const selectedId = trackStore.value?.selectedTrackId;
                if (selectedId) {
                    duplicateTrack(selectedId);
                }
                return;
            }

            if (e.altKey && e.key.toLowerCase() === "d" && !mod) {
                if (isInput) {
                    return;
                }
                e.preventDefault();
                const selectedClipId = workspaceStore.value?.selectedClipId;
                if (selectedClipId) {
                    duplicateClipToNextBar(selectedClipId);
                }
                return;
            }

            if (mod && e.key.toLowerCase() === "d" && !e.shiftKey && !e.altKey) {
                if (isInput) {
                    return;
                }
                e.preventDefault();
                const selectedClipId = workspaceStore.value?.selectedClipId;
                if (selectedClipId) {
                    duplicateClip(selectedClipId);
                }
                return;
            }

            if (mod && e.shiftKey && e.key.toLowerCase() === "f") {
                if (isInput) {
                    return;
                }
                e.preventDefault();
                zoomToFit();
                return;
            }

            if (mod && e.shiftKey && (e.key === "=" || e.key === "+")) {
                if (isInput) {
                    return;
                }
                e.preventDefault();
                zoomTracksVertical(10);
                return;
            }

            if (mod && e.shiftKey && e.key === "-") {
                if (isInput) {
                    return;
                }
                e.preventDefault();
                zoomTracksVertical(-10);
                return;
            }

            if (e.key === "v" && !mod && !e.shiftKey && !e.altKey) {
                if (isInput) {
                    return;
                }
                e.preventDefault();
                document.dispatchEvent(new CustomEvent("webdaw:toggle-voice-command", { detail: { active: true } }));
                return;
            }

            if (e.altKey && e.key.toLowerCase() === "s" && !mod) {
                if (isInput) return;
                e.preventDefault();
                clearSolos();
                return;
            }

            if (isInput) {
                return;
            }

            switch (e.key) {
                case " ":
                    e.preventDefault();
                    togglePlayback();
                    break;
                case "Escape": {
                    const ws = workspaceStore.value;
                    if (ws && (ws.selectedClipIds.length > 0 || ws.selectedClipId)) {
                        workspaceStore.set({ ...ws, selectedClipIds: [], selectedClipId: null });
                    } else {
                        stopPlayback();
                    }
                    break;
                }
                case "l":
                    toggleLoop();
                    break;
                case "L":
                    document.dispatchEvent(new CustomEvent("webdaw:scroll-to-playhead"));
                    break;
                case "m":
                    toggleMetronome();
                    break;
                case "r":
                    toggleRecording();
                    break;
                case "Home":
                    e.preventDefault();
                    seekPlayhead(0);
                    break;
                case "End":
                    e.preventDefault();
                    seekPlayhead(getLastClipEndBeat());
                    break;
                case "=":
                case "+":
                    e.preventDefault();
                    zoomTimeline(ZOOM_STEP);
                    break;
                case "-":
                    e.preventDefault();
                    zoomTimeline(-ZOOM_STEP);
                    break;
                case "]":
                    goToNextMarker();
                    break;
                case "[":
                    goToPreviousMarker();
                    break;
                case "f":
                    zoomToFit();
                    break;
                case "F":
                    zoomToSelection();
                    break;
                case "n":
                    addTrack({ name: "MIDI", kind: "midi" });
                    break;
                case "N":
                    if (e.shiftKey) {
                        addTrack({ name: "Audio", kind: "audio" });
                    }
                    break;
                case "Tab":
                    e.preventDefault();
                    toggleWorkspaceMode();
                    break;
                default: {
                    const numberTool = NUMBER_TOOL_MAP[e.key];
                    if (numberTool) {
                        setEditingTool(numberTool);
                        break;
                    }
                    const tool = TOOL_SHORTCUTS[e.key];
                    if (tool) {
                        setEditingTool(tool);
                    }
                    break;
                }
            }
        };

        window.addEventListener("keydown", handler);

        const keyupHandler = (e: KeyboardEvent) => {
            if (e.key === "v") {
                document.dispatchEvent(new CustomEvent("webdaw:toggle-voice-command", { detail: { active: false } }));
            }
        };
        window.addEventListener("keyup", keyupHandler);

        return () => {
            window.removeEventListener("keydown", handler);
            window.removeEventListener("keyup", keyupHandler);
        };
    }, []);
};
