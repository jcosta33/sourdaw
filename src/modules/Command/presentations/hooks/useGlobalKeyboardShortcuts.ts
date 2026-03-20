import { useEffect } from 'react';
import {
    togglePlayback,
    stopPlayback,
    toggleLoop,
    toggleMetronome,
    toggleRecording,
    seekPlayhead,
    clearSolos,
    setEditingTool,
    zoomToFit,
    zoomToSelection,
    addTrack,
    duplicateTrack,
    duplicateClip,
    duplicateClipToNextBar,
    zoomTracksVertical,
    TOOL_SHORTCUTS,
    type EditingTool,
} from '../../useCases/keyboardShortcutActions';
import { undo, redo } from '../../useCases/undoRedo';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { trackStore } from '#/modules/Track/stores/trackStore';
import { zoomTimeline } from '#/modules/Timeline/stores/timelineViewStore';
import { getAllClipIds, getLastClipEndBeat, goToNextMarker, goToPreviousMarker } from '../../helpers/selectionHelpers';

const ZOOM_STEP = 4;

const NUMBER_TOOL_MAP: Record<string, EditingTool> = {
    '1': 'select',
    '2': 'cut',
    '3': 'draw',
    '4': 'automation',
    '5': 'stretch',
};

const toggleWorkspaceMode = (): void => {
    const ws = workspaceStore.value;
    if (!ws) {
        return;
    }
    const nextMode = ws.mode === 'arrange' ? 'clip' : 'arrange';
    workspaceStore.set({ ...ws, mode: nextMode });
};

export const useGlobalKeyboardShortcuts = (): void => {
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
            const mod = e.metaKey || e.ctrlKey;

            if (e.key === 'k' && mod) {
                e.preventDefault();
                const ws = workspaceStore.value;
                if (ws) {
                    workspaceStore.set({ ...ws, commandPaletteOpen: !ws.commandPaletteOpen });
                }
                return;
            }

            if (e.key.toLowerCase() === 'z' && mod) {
                e.preventDefault();
                if (e.shiftKey) {
                    void redo();
                } else {
                    void undo();
                }
                return;
            }

            if (mod && e.key === 'a' && !e.shiftKey) {
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

            if (mod && e.shiftKey && e.key.toLowerCase() === 'a') {
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

            if (mod && e.shiftKey && e.key.toLowerCase() === 'd') {
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

            if (e.altKey && e.key.toLowerCase() === 'd' && !mod) {
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

            if (mod && e.key.toLowerCase() === 'd' && !e.shiftKey && !e.altKey) {
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

            if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
                if (isInput) {
                    return;
                }
                e.preventDefault();
                zoomToFit();
                return;
            }

            if (mod && e.shiftKey && (e.key === '=' || e.key === '+')) {
                if (isInput) {
                    return;
                }
                e.preventDefault();
                zoomTracksVertical(10);
                return;
            }

            if (mod && e.shiftKey && e.key === '-') {
                if (isInput) {
                    return;
                }
                e.preventDefault();
                zoomTracksVertical(-10);
                return;
            }

            if (e.key === 'v' && !mod && !e.shiftKey && !e.altKey && !e.repeat) {
                if (isInput) {
                    return;
                }
                e.preventDefault();
                document.dispatchEvent(new CustomEvent('webdaw:toggle-voice-command', { detail: { active: true } }));
                return;
            }

            if (e.altKey && e.key.toLowerCase() === 's' && !mod) {
                if (isInput) {
                    return;
                }
                e.preventDefault();
                clearSolos();
                return;
            }

            if (isInput) {
                return;
            }

            switch (e.key) {
                case ' ':
                    e.preventDefault();
                    togglePlayback();
                    break;
                case 'Escape': {
                    const ws = workspaceStore.value;
                    if (ws && (ws.selectedClipIds.length > 0 || ws.selectedClipId)) {
                        workspaceStore.set({ ...ws, selectedClipIds: [], selectedClipId: null });
                    } else {
                        stopPlayback();
                    }
                    break;
                }
                case 'l':
                    toggleLoop();
                    break;
                case 'L':
                    document.dispatchEvent(new CustomEvent('webdaw:scroll-to-playhead'));
                    break;
                case 'm':
                    toggleMetronome();
                    break;
                case 'r':
                    toggleRecording();
                    break;
                case 'Home':
                    e.preventDefault();
                    seekPlayhead(0);
                    break;
                case 'End':
                    e.preventDefault();
                    seekPlayhead(getLastClipEndBeat());
                    break;
                case '=':
                case '+':
                    e.preventDefault();
                    zoomTimeline(ZOOM_STEP);
                    break;
                case '-':
                    e.preventDefault();
                    zoomTimeline(-ZOOM_STEP);
                    break;
                case ']':
                    goToNextMarker();
                    break;
                case '[':
                    goToPreviousMarker();
                    break;
                case 'f':
                    zoomToFit();
                    break;
                case 'F':
                    zoomToSelection();
                    break;
                case 'n':
                    addTrack({ name: 'MIDI', kind: 'midi' });
                    break;
                case 'N':
                    if (e.shiftKey) {
                        addTrack({ name: 'Audio', kind: 'audio' });
                    }
                    break;
                case 'Tab':
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

        window.addEventListener('keydown', handler);

        const keyupHandler = (e: KeyboardEvent) => {
            if (e.key === 'v') {
                document.dispatchEvent(new CustomEvent('webdaw:toggle-voice-command', { detail: { active: false } }));
            }
        };
        window.addEventListener('keyup', keyupHandler);

        return () => {
            window.removeEventListener('keydown', handler);
            window.removeEventListener('keyup', keyupHandler);
        };
    }, []);
};
