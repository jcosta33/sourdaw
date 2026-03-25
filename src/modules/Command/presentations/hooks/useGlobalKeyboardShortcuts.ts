import { useEffect } from 'react';
import {
    stopPlayback,
    toggleMetronome,
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
} from '../../useCases/keyboardShortcutActions';

import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { zoomTimeline } from '#/modules/Arrangement/stores/timelineViewStore';
import { getAllClipIds, getLastClipEndBeat, goToNextMarker, goToPreviousMarker } from '../../useCases/selectionHelpers';
import { cycleAutomationVisibility, toggleCommandPalette, selectAllClips, clearClipSelection, toggleWorkspaceMode } from '#/modules/Workspace/useCases/togglePanel';
import { type EditingTool, TOOL_SHORTCUTS } from '#/modules/Workspace/useCases/workspaceQueries';

const ZOOM_STEP = 4;

const NUMBER_TOOL_MAP: Record<string, EditingTool> = {
    '1': 'select',
    '2': 'cut',
    '3': 'draw',
    '4': 'automation',
    '5': 'stretch',
};

const cycleWorkspaceMode = (): void => {
    toggleWorkspaceMode();
};

export const useGlobalKeyboardShortcuts = (): void => {
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
            const mod = e.metaKey || e.ctrlKey;

            if (e.key === 'k' && mod) {
                e.preventDefault();
                toggleCommandPalette();
                return;
            }

            if (mod && e.key === 'a' && !e.shiftKey) {
                if (isInput) {
                    return;
                }
                e.preventDefault();
                selectAllClips(getAllClipIds);
                return;
            }

            if (mod && e.shiftKey && e.key.toLowerCase() === 'a') {
                if (isInput) {
                    return;
                }
                e.preventDefault();
                clearClipSelection();
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
                case 'Escape': {
                    const ws = workspaceStore.value;
                    if (ws && (ws.selectedClipIds.length > 0 || ws.selectedClipId)) {
                        clearClipSelection();
                    } else {
                        stopPlayback();
                    }
                    break;
                }
                case 'L':
                    document.dispatchEvent(new CustomEvent('webdaw:scroll-to-playhead'));
                    break;
                case 'm':
                    toggleMetronome();
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
                    cycleWorkspaceMode();
                    break;
                case 'a':
                    cycleAutomationVisibility();
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
