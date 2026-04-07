import { inject } from '#/infra/di/inject';
import { stopPlayback, toggleMetronome, seekPlayhead } from './transportShortcuts';
import {
    clearSolos,
    addTrack,
    duplicateTrack,
    duplicateClip,
    duplicateClipToNextBar,
    zoomTracksVertical,
} from './trackShortcuts';
import { setEditingTool, zoomToFit, zoomToSelection } from './workspaceShortcuts';

import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { zoomTimeline } from '#/modules/Arrangement/stores/timelineViewStore';
import { getAllClipIds, getLastClipEndBeat, goToNextMarker, goToPreviousMarker } from '../selectionHelpers';
import { cycleAutomationVisibility } from '#/modules/Workspace/useCases/togglePanel/zoomOperations';
import {
    toggleCommandPalette,
    selectAllClips,
    clearClipSelection,
    toggleWorkspaceMode,
} from '#/modules/Workspace/useCases/togglePanel/panelToggles';
import { type EditingTool, TOOL_SHORTCUTS } from '#/modules/Workspace/useCases/workspaceQueries';
import { eventBus } from '#/app/registerDependencies';

const ZOOM_STEP = 4;

const NUMBER_TOOL_MAP: Record<string, EditingTool> = {
    '1': 'select',
    '2': 'cut',
    '3': 'draw',
    '4': 'automation',
    '5': 'stretch',
};

export type KeyDescriptor = {
    key: string;
    mod: boolean;
    shift: boolean;
    alt: boolean;
    repeat: boolean;
    isInput: boolean;
};

/**
 * Handles a keydown event by mapping it to the appropriate action.
 * Returns `true` if the caller should call `preventDefault()`.
 */
export const handleKeydown = inject({ eventBus })(
    ({ eventBus }) => {
        const handleSimpleKeys = (key: string, shift: boolean): boolean => {
            switch (key) {
                case 'Escape': {
                    const ws = workspaceStore.value;
                    if (ws && (ws.selectedClipIds.length > 0 || ws.selectedClipId)) {
                        clearClipSelection();
                    } else {
                        stopPlayback();
                    }
                    return false;
                }
                case 'L':
                    eventBus.emit('zoom.scrollToPlayhead', undefined);
                    return false;
                case 'm':
                    toggleMetronome();
                    return false;
                case 'Home':
                    seekPlayhead(0);
                    return true;
                case 'End':
                    seekPlayhead(getLastClipEndBeat());
                    return true;
                case '=':
                case '+':
                    zoomTimeline(ZOOM_STEP);
                    return true;
                case '-':
                    zoomTimeline(-ZOOM_STEP);
                    return true;
                case ']':
                    goToNextMarker();
                    return false;
                case '[':
                    goToPreviousMarker();
                    return false;
                case 'f':
                    zoomToFit();
                    return false;
                case 'F':
                    zoomToSelection();
                    return false;
                case 'n':
                    addTrack({ name: 'MIDI', kind: 'midi' });
                    return false;
                case 'N':
                    if (shift) {
                        addTrack({ name: 'Audio', kind: 'audio' });
                    }
                    return false;
                case 'Tab':
                    toggleWorkspaceMode();
                    return true;
                case 'a':
                    cycleAutomationVisibility();
                    return false;
                default: {
                    const numberTool = NUMBER_TOOL_MAP[key];
                    if (numberTool) {
                        setEditingTool(numberTool);
                        return false;
                    }
                    const tool = TOOL_SHORTCUTS[key];
                    if (tool) {
                        setEditingTool(tool);
                    }
                    return false;
                }
            }
        };

        return function handleKeydown(desc: KeyDescriptor): boolean {
            const { key, mod, shift, alt, repeat, isInput } = desc;

            // Cmd+K: command palette (always, even in inputs)
            if (key === 'k' && mod) {
                toggleCommandPalette();
                return true;
            }

            // Cmd+A: select all clips
            if (mod && key === 'a' && !shift) {
                if (isInput) return false;
                selectAllClips(getAllClipIds);
                return true;
            }

            // Cmd+Shift+A: clear clip selection
            if (mod && shift && key.toLowerCase() === 'a') {
                if (isInput) return false;
                clearClipSelection();
                return true;
            }

            // Cmd+Shift+D: duplicate track
            if (mod && shift && key.toLowerCase() === 'd') {
                if (isInput) return false;
                const selectedId = trackStore.value?.selectedTrackId;
                if (selectedId) {
                    duplicateTrack(selectedId);
                }
                return true;
            }

            // Alt+D: duplicate clip to next bar
            if (alt && key.toLowerCase() === 'd' && !mod) {
                if (isInput) return false;
                const selectedClipId = workspaceStore.value?.selectedClipId;
                if (selectedClipId) {
                    duplicateClipToNextBar(selectedClipId);
                }
                return true;
            }

            // Cmd+D: duplicate clip
            if (mod && key.toLowerCase() === 'd' && !shift && !alt) {
                if (isInput) return false;
                const selectedClipId = workspaceStore.value?.selectedClipId;
                if (selectedClipId) {
                    duplicateClip(selectedClipId);
                }
                return true;
            }

            // Cmd+Shift+F: zoom to fit
            if (mod && shift && key.toLowerCase() === 'f') {
                if (isInput) return false;
                zoomToFit();
                return true;
            }

            // Cmd+Shift++: zoom tracks in
            if (mod && shift && (key === '=' || key === '+')) {
                if (isInput) return false;
                zoomTracksVertical(10);
                return true;
            }

            // Cmd+Shift+-: zoom tracks out
            if (mod && shift && key === '-') {
                if (isInput) return false;
                zoomTracksVertical(-10);
                return true;
            }

            // V: voice toggle (press)
            if (key === 'v' && !mod && !shift && !alt && !repeat) {
                if (isInput) return false;
                eventBus.emit('voice.toggle', { active: true });
                return true;
            }

            // Alt+S: clear solos
            if (alt && key.toLowerCase() === 's' && !mod) {
                if (isInput) return false;
                clearSolos();
                return true;
            }

            // All remaining shortcuts are blocked in input fields
            if (isInput) return false;

            return handleSimpleKeys(key, shift);
        };
    }
);

/**
 * Handles a keyup event for shortcuts that need release tracking.
 */
export const handleKeyup = inject({ eventBus })(
    ({ eventBus }) =>
        function handleKeyup(key: string): void {
            if (key === 'v') {
                eventBus.emit('voice.toggle', { active: false });
            }
        }
);
