import { inject } from '#/infra/di/inject';
import { pushUndoEntry } from '../../pushUndoEntry';
import { stopPlayback, seekPlayhead, setLoopRegion } from '#/modules/Transport/useCases';
import {
    acceptGhostClip,
    dismissGhostClip,
    deleteTimeRange,
    insertTime,
    duplicateTimeRange,
    removeClip,
} from '#/modules/Arrangement/useCases';

import { duplicateTrack } from '../trackShortcuts/duplicateTrack';

import { workspaceStore } from '#/modules/Workspace/stores';

import {
    cycleAutomationVisibility,
    toggleCommandPalette,
    selectAllClips,
    clearClipSelection,
    selectClipWithFocus,
    toggleWorkspaceMode,
    setEditingTool,
    type EditingTool,
    TOOL_SHORTCUTS,
} from '#/modules/Workspace/useCases';

import { trackStore, zoomTimeline } from '#/modules/Arrangement/stores';
import { duplicateSelectedClipsForward } from '../clipShortcuts/duplicateSelectedClipsForward';
import { getAllClipIds } from '../../selectionHelpers/getAllClipIds';
import { getLastClipEndBeat } from '../../selectionHelpers/getLastClipEndBeat';
import { goToNextMarker } from '../../selectionHelpers/goToNextMarker';
import { goToPreviousMarker } from '../../selectionHelpers/goToPreviousMarker';
import { eventBus } from '#/app/registerDependencies';
import { shortcutStore, type ShortcutAction } from '../../../stores/shortcutStore';
import { executeAppAction } from '../../executeAppAction';
import { toolSwapStore, getWorkspaceState } from '#/modules/Workspace';

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

function matches(desc: KeyDescriptor, keys: string[]): boolean {
    return keys.some((combo) => {
        const parts = combo.split('+');
        const keyPart = parts.pop();
        if (!keyPart) {
            return false;
        }

        const hasMod = parts.includes('mod');
        const hasShift = parts.includes('shift');
        const hasAlt = parts.includes('alt');

        const normalizedKey = keyPart === 'Space' ? ' ' : keyPart;
        const eventKey = desc.key;

        // Simple match for exact key or case-insensitive character match
        const keyMatch =
            normalizedKey === eventKey ||
            (normalizedKey.length === 1 &&
                eventKey.length === 1 &&
                normalizedKey.toLowerCase() === eventKey.toLowerCase());

        return keyMatch && hasMod === desc.mod && hasShift === desc.shift && hasAlt === desc.alt;
    });
}

/**
 * Handles a keydown event by mapping it to the appropriate action.
 * Returns `true` if the caller should call `preventDefault()`.
 */
export const handleKeydown = inject({ eventBus, executeAppAction })(
    ({ eventBus, executeAppAction }) => {
        const executeShortcutAction = (action: ShortcutAction): boolean => {
            if (action.type === 'appAction') {
                const { type, payload } = action.action;

                // Handle dynamic payloads
                if (type === 'duplicateClip' && (payload as { clipId?: string })?.clipId === 'selected') {
                    // R-B4: if marquee selection exists, duplicate the time range forward (Cmd+D)
                    const marq = workspaceStore.value?.marqueeSelection;
                    if (marq && marq.endBeat > marq.startBeat) {
                        duplicateTimeRange(marq.startBeat, marq.endBeat);
                        // Push undo entry (duplicateTimeRange does NOT push its own in this appAction path)
                        const duration = marq.endBeat - marq.startBeat;
                        pushUndoEntry(
                            'Duplicate Time Range',
                            () => deleteTimeRange(marq.endBeat, marq.endBeat + duration, (trackStore.value?.tracks ?? []).map((t) => t.id)),
                            () => duplicateTimeRange(marq.startBeat, marq.endBeat)
                        );
                        return true;
                    }

                    // R-B2: if multiple clips are selected, duplicate all forward by selection span
                    const selectedClipIds = workspaceStore.value?.selectedClipIds ?? [];
                    if (selectedClipIds.length > 1) {
                        duplicateSelectedClipsForward(selectedClipIds);
                    } else {
                        const selectedClipId = workspaceStore.value?.selectedClipId;
                        if (selectedClipId) {
                            executeAppAction({ type: 'duplicateClip', payload: { clipId: selectedClipId } });
                        }
                    }
                    return true;
                }
                if (type === 'duplicateClipToNextBar' && (payload as { clipId?: string })?.clipId === 'selected') {
                    const selectedClipId = workspaceStore.value?.selectedClipId;
                    if (selectedClipId) {
                        executeAppAction({ type: 'duplicateClipToNextBar', payload: { clipId: selectedClipId } });
                    }
                    return true;
                }

                executeAppAction(action.action);
                return true;
            }
            if (action.type === 'callback') {
                switch (action.id) {
                    case 'stopPlayback': {
                        // R-E1.2: Escape dismisses selected ghost clip first
                        const selectedId = workspaceStore.value?.selectedClipId;
                        if (selectedId) {
                            const state = trackStore.value;
                            const isGhost =
                                ((state?.ghostClips) ?? []).some((g) => g.id === selectedId) ||
                                state?.tracks.flatMap((t) => t.clips).some((c) => c.id === selectedId && c.isGhost);

                            if (isGhost) {
                                dismissGhostClip(selectedId);
                                return true;
                            }
                        }
                        const ws = workspaceStore.value;
                        if (ws && (ws.selectedClipIds.length > 0 || ws.selectedClipId)) {
                            clearClipSelection();
                        } else {
                            stopPlayback();
                        }
                        return false;
                    }
                    case 'zoomIn':
                        zoomTimeline(ZOOM_STEP);
                        return true;
                    case 'zoomOut':
                        zoomTimeline(-ZOOM_STEP);
                        return true;
                    case 'toggleCommandPalette':
                        toggleCommandPalette();
                        return true;
                    case 'selectAllClips':
                        selectAllClips(getAllClipIds);
                        return true;
                    case 'clearClipSelection':
                        clearClipSelection();
                        return true;
                    case 'duplicateTrack': {
                        const selectedId = trackStore.value?.selectedTrackId;
                        if (selectedId) {
                            duplicateTrack(selectedId);
                        }
                        return true;
                    }
                    case 'cycleAutomationVisibility':
                        cycleAutomationVisibility();
                        return false;
                    case 'toggleWorkspaceMode': {
                        // R-E1.2: Tab accepts selected ghost clip first
                        const selectedId = workspaceStore.value?.selectedClipId;
                        if (selectedId) {
                            const state = trackStore.value;
                            const isGhost =
                                ((state?.ghostClips) ?? []).some((g) => g.id === selectedId) ||
                                state?.tracks.flatMap((t) => t.clips).some((c) => c.id === selectedId && c.isGhost);

                            if (isGhost) {
                                acceptGhostClip(selectedId);
                                return true;
                            }
                        }
                        toggleWorkspaceMode();
                        return true;
                    }
                    case 'loopFromSelection': {
                        // R-B4: time (marquee) selection takes priority over clip selection
                        const marq = workspaceStore.value?.marqueeSelection;
                        if (marq && marq.endBeat > marq.startBeat) {
                            setLoopRegion(marq.startBeat, marq.endBeat);
                            return true;
                        }
                        // R-B5: set transport loop region to the earliest start / latest end of selected clips
                        const selectedIds = workspaceStore.value?.selectedClipIds ?? [];
                        if (selectedIds.length > 0) {
                            const state = trackStore.value;
                            if (state) {
                                let lo = Infinity;
                                let hi = -Infinity;
                                for (const track of state.tracks) {
                                    for (const clip of track.clips) {
                                        if (selectedIds.includes(clip.id)) {
                                            if (clip.startBeat < lo) lo = clip.startBeat;
                                            if (clip.endBeat > hi) hi = clip.endBeat;
                                        }
                                    }
                                }
                                if (lo < hi) {
                                    setLoopRegion(lo, hi);
                                }
                            }
                        }
                        return true;
                    }
                    case 'deleteTimeRange': {
                        // R-B4: delete contents of time selection (marqueeSelection)
                        const sel = workspaceStore.value?.marqueeSelection;
                        if (!sel) return false;
                        // deleteTimeRange already pushes its own undo entry
                        deleteTimeRange(sel.startBeat, sel.endBeat, sel.trackIds);
                        return true;
                    }
                    case 'insertSilence': {
                        // R-B4: insert silence (gap) at the time selection range
                        const sel = workspaceStore.value?.marqueeSelection;
                        if (!sel) return false;
                        const duration = sel.endBeat - sel.startBeat;
                        const atBeat = sel.startBeat;
                        insertTime(atBeat, duration);
                        pushUndoEntry(
                            'Insert Silence',
                            () => deleteTimeRange(atBeat, atBeat + duration, (trackStore.value?.tracks ?? []).map((t) => t.id)),
                            () => insertTime(atBeat, duration)
                        );
                        return true;
                    }
                    case 'duplicateTimeRange': {
                        // R-B4: duplicate the time selection range forward
                        const sel = workspaceStore.value?.marqueeSelection;
                        if (!sel) return false;
                        const { startBeat, endBeat } = sel;
                        const duration = endBeat - startBeat;
                        duplicateTimeRange(startBeat, endBeat);
                        pushUndoEntry(
                            'Duplicate Time Range',
                            () => deleteTimeRange(endBeat, endBeat + duration, (trackStore.value?.tracks ?? []).map((t) => t.id)),
                            () => duplicateTimeRange(startBeat, endBeat)
                        );
                        return true;
                    }
                    case 'cycleGhostClipNext':
                    case 'cycleGhostClipPrev': {
                        // R-E1.2: Alt+]/[ cycle through ghost clips
                        const state = trackStore.value;
                        const allGhosts = [
                            ...(state?.tracks ?? []).flatMap((t) => t.clips).filter((c) => c.isGhost),
                            ...(state?.ghostClips ?? []),
                        ].map((c) => c.id);

                        if (allGhosts.length === 0) return false;
                        const currentId = workspaceStore.value?.selectedClipId;
                        const currentIdx = currentId ? allGhosts.indexOf(currentId) : -1;
                        const dir = action.id === 'cycleGhostClipNext' ? 1 : -1;
                        const nextIdx = (currentIdx + dir + allGhosts.length) % allGhosts.length;
                        const nextId = allGhosts[nextIdx];
                        if (nextId) {
                            selectClipWithFocus(nextId);
                        }
                        return true;
                    }
                    default:
                        return false;
                }
            }
            return false;
        };

        const handleSimpleKeys = (key: string, desc: KeyDescriptor): boolean => {
            // Check shortcut store first
            const { definitions, customMappings } = shortcutStore.value ?? {
                definitions: [],
                customMappings: {},
            };
            for (const def of definitions) {
                const keys = customMappings[def.id] ?? def.defaultKeys;
                if (matches(desc, keys)) {
                    return executeShortcutAction(def.action);
                }
            }

            switch (key) {
                case 'L':
                    eventBus.emit('zoom.scrollToPlayhead', undefined);
                    return false;
                case 'Delete':
                case 'Backspace': {
                    // R-B4: Delete key deletes time range if marquee exists
                    const marq = workspaceStore.value?.marqueeSelection;
                    if (marq && marq.endBeat > marq.startBeat) {
                        deleteTimeRange(marq.startBeat, marq.endBeat, marq.trackIds);
                        return true;
                    }
                    // Else, standard clip deletion if clips are selected
                    const selectedIds = workspaceStore.value?.selectedClipIds ?? [];
                    if (selectedIds.length > 0) {
                        for (const id of selectedIds) {
                            removeClip(id);
                        }
                        return true;
                    }
                    return false;
                }
                case 'Home':
                    seekPlayhead(0);
                    return true;
                case 'End':
                    seekPlayhead(getLastClipEndBeat());
                    return true;
                case ']':
                    goToNextMarker();
                    return false;
                case '[':
                    goToPreviousMarker();
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

            // V: voice toggle (press)
            if (key === 'v' && !mod && !shift && !alt && !repeat) {
                if (isInput) {
                    return false;
                }
                eventBus.emit('voice.toggle', { active: true });
                return true;
            }

            // Check shortcut store first for ALL keys (including those with modifiers)
            const { definitions, customMappings } = shortcutStore.value ?? {
                definitions: [],
                customMappings: {},
            };
            for (const def of definitions) {
                const keys = customMappings[def.id] ?? def.defaultKeys;
                if (matches(desc, keys)) {
                    // Some shortcuts (like Cmd+K) should work even in inputs
                    const allowedInInput = def.id === 'workspace.toggleCommandPalette';
                    if (isInput && !allowedInInput) {
                        continue;
                    }
                    return executeShortcutAction(def.action);
                }
            }

            // All remaining shortcuts are blocked in input fields
            if (isInput) {
                // EXCEPT Cmd+K which is special and handled above if migrated, 
                // but let's keep the legacy fallback for now if not migrated.
                if (key === 'k' && mod) {
                    toggleCommandPalette();
                    return true;
                }
                return false;
            }

            // R-A3: Track hold duration for tool shortcuts (press-and-hold for temporary swap)
            const normalizedKey = key.toLowerCase();
            const tool = NUMBER_TOOL_MAP[key] || TOOL_SHORTCUTS[normalizedKey];
            if (tool && !mod && !shift && !alt && !repeat) {
                const currentTool = getWorkspaceState()?.activeTool;
                // Only track swap if it's a different tool than current
                if (currentTool && currentTool !== tool) {
                    toolSwapStore.set({
                        lastDownTime: performance.now(),
                        lastDownKey: key,
                        previousTool: currentTool,
                    });
                }
            }

            return handleSimpleKeys(key, desc);
        };
    }
);
