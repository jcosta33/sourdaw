import { eventBus } from '#/app/registerDependencies';
import { inject } from '#/infra/di/inject';
import { trackStore, zoomTimeline } from '#/modules/Arrangement/stores';
import {
    acceptGhostClip,
    dismissGhostClip,
    deleteTimeRange,
    insertTime,
    duplicateTimeRange,
    removeClip,
    addClip,
} from '#/modules/Arrangement/useCases';
import { stopPlayback, seekPlayhead, setLoopRegion } from '#/modules/Transport/useCases';
import { workspaceStore, toolSwapStore } from '#/modules/Workspace/stores';
import {
    clearClipSelection,
    cycleAutomationVisibility,
    openExportDialog,
    openPreferencesDialog,
    selectAllClips,
    selectClipWithFocus,
    setEditingTool,
    setMarqueeSelection,
    showAutomationPanel,
    toggleCommandPalette,
    toggleMixer,
    toggleTrackList,
    toggleVirtualKeyboard,
    toggleWorkspaceMode,
    type EditingTool,
    TOOL_SHORTCUTS,
} from '#/modules/Workspace/useCases';
import { getWorkspaceState } from '#/modules/Workspace/useCases';

import { shortcutStore, type ShortcutAction } from '../../../stores/shortcutStore';
import { executeAppAction } from '../../executeAppAction';
import { pushUndoEntry } from '../../pushUndoEntry';
import { getAllClipIds } from '../../selectionHelpers/getAllClipIds';
import { getLastClipEndBeat } from '../../selectionHelpers/getLastClipEndBeat';
import { goToNextMarker } from '../../selectionHelpers/goToNextMarker';
import { goToPreviousMarker } from '../../selectionHelpers/goToPreviousMarker';
import { undo, redo } from '../../undoRedo';
import { duplicateSelectedClipsForward } from '../clipShortcuts/duplicateSelectedClipsForward';
import { duplicateTrack } from '../trackShortcuts/duplicateTrack';

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
        // Special-case: combos whose final key is `+`. A bare `'+'` or a combo
        // like `'mod++'` / `'mod+shift++'` previously broke `matches` because
        // `split('+')` turns the trailing `+` into an empty string and `pop()`
        // returns `''` instead of the `+` key. Peel off the trailing `+` and
        // recover the modifier list before splitting.
        let keyPart: string;
        let modifiers: string[];
        if (combo === '+') {
            keyPart = '+';
            modifiers = [];
        } else if (combo.endsWith('++')) {
            keyPart = '+';
            modifiers = combo.slice(0, -2).split('+');
        } else {
            const parts = combo.split('+');
            const popped = parts.pop();
            if (!popped) {
                return false;
            }
            keyPart = popped;
            modifiers = parts;
        }

        const hasMod = modifiers.includes('mod');
        const hasShift = modifiers.includes('shift');
        const hasAlt = modifiers.includes('alt');

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
function getSelectedGhostClipId(): string | null {
    const selectedId = workspaceStore.value?.selectedClipId;
    if (!selectedId) {
        return null;
    }
    const state = trackStore.value;
    const isGhost =
        (state?.ghostClips ?? []).some((g) => g.id === selectedId) ||
        state?.tracks.flatMap((t) => t.clips).some((c) => c.id === selectedId && c.isGhost);
    return isGhost ? selectedId : null;
}

function executeDuplicateTimeRange(startBeat: number, endBeat: number): void {
    const duration = endBeat - startBeat;
    const trackIdsAtAction = (trackStore.value?.tracks ?? []).map((t) => t.id);
    duplicateTimeRange(startBeat, endBeat);
    pushUndoEntry(
        'Duplicate Time Range',
        () => deleteTimeRange(endBeat, endBeat + duration, trackIdsAtAction),
        () => duplicateTimeRange(startBeat, endBeat)
    );
}

export const handleKeydown = inject({ eventBus })(({ eventBus }) => {
    function executeShortcutAction(action: ShortcutAction): boolean {
        if (action.type === 'appAction') {
            const { type, payload } = action.action;

            // Handle dynamic payloads
            if (type === 'duplicateClip' && (payload as { clipId?: string })?.clipId === 'selected') {
                // R-B4: if marquee selection exists, duplicate the time range forward (Cmd+D)
                const marq = workspaceStore.value?.marqueeSelection;
                if (marq && marq.endBeat > marq.startBeat) {
                    executeDuplicateTimeRange(marq.startBeat, marq.endBeat);
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
                    const ghostId = getSelectedGhostClipId();
                    if (ghostId) {
                        dismissGhostClip(ghostId);
                        return true;
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
                    const ghostId = getSelectedGhostClipId();
                    if (ghostId) {
                        acceptGhostClip(ghostId);
                        return true;
                    }
                    toggleWorkspaceMode();
                    return true;
                }

                // ── Undo / redo ──────────────────────────────────────
                case 'undo':
                    void undo();
                    return true;
                case 'redo':
                    void redo();
                    return true;

                // ── Delete (marquee-aware) ───────────────────────────
                case 'deleteSelection':
                    return deleteSelectionShortcut();

                // ── Panel toggles (not expressible as AppAction) ─────
                case 'toggleMixer':
                    toggleMixer();
                    return true;
                case 'toggleTrackList':
                    toggleTrackList();
                    return true;
                case 'toggleVirtualKeyboard':
                    toggleVirtualKeyboard();
                    return true;
                case 'showAutomationPanel':
                    showAutomationPanel();
                    return true;

                // ── Dialog openers (emit event the dialog listens to)─
                case 'openExportDialog':
                    openExportDialog();
                    return true;
                case 'openPreferencesDialog':
                    openPreferencesDialog();
                    return true;

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
                                        if (clip.startBeat < lo) {
                                            lo = clip.startBeat;
                                        }
                                        if (clip.endBeat > hi) {
                                            hi = clip.endBeat;
                                        }
                                    }
                                }
                            }
                            if (lo < hi) {
                                setLoopRegion(lo, hi);
                            }
                        }
                    } else {
                        // Fallback: single selected clip
                        const singleId = workspaceStore.value?.selectedClipId;
                        if (singleId) {
                            const state = trackStore.value;
                            if (state) {
                                for (const track of state.tracks) {
                                    const clip = track.clips.find((c) => c.id === singleId);
                                    if (clip) {
                                        setLoopRegion(clip.startBeat, clip.endBeat);
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    return true;
                }
                case 'deleteTimeRange': {
                    // R-B4: delete contents of time selection (marqueeSelection)
                    const sel = workspaceStore.value?.marqueeSelection;
                    if (!sel) {
                        return false;
                    }
                    // deleteTimeRange already pushes its own undo entry
                    deleteTimeRange(sel.startBeat, sel.endBeat, sel.trackIds);
                    return true;
                }
                case 'insertSilence': {
                    // R-B4: insert silence (gap) at the time selection range
                    const sel = workspaceStore.value?.marqueeSelection;
                    if (!sel) {
                        return false;
                    }
                    const duration = sel.endBeat - sel.startBeat;
                    const atBeat = sel.startBeat;
                    const trackIdsAtAction = (trackStore.value?.tracks ?? []).map((t) => t.id);
                    insertTime(atBeat, duration);
                    pushUndoEntry(
                        'Insert Silence',
                        () => deleteTimeRange(atBeat, atBeat + duration, trackIdsAtAction),
                        () => insertTime(atBeat, duration)
                    );
                    return true;
                }
                case 'duplicateTimeRange': {
                    // R-B4: duplicate the time selection range forward
                    const sel = workspaceStore.value?.marqueeSelection;
                    if (!sel) {
                        return false;
                    }
                    executeDuplicateTimeRange(sel.startBeat, sel.endBeat);
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

                    if (allGhosts.length === 0) {
                        return false;
                    }
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

    /**
     * Delete callback used by `editing.deleteSelection` (Delete / Backspace).
     * Splits into two distinct paths:
     *   • If a marquee selection is active, delete the time range on those
     *     tracks (not undoable today — tracked separately in the audit).
     *   • Otherwise, delete the currently selected clip(s), pushing an
     *     undo entry so the action is reversible.
     * Returns `true` when the caller should `preventDefault()`. Returns
     * `false` when there is nothing to delete, so the browser default
     * (caret backspace in inputs etc.) is preserved — handleKeydown
     * already excludes input targets before reaching this branch.
     */
    function deleteSelectionShortcut(): boolean {
        const ws = workspaceStore.value;
        if (!ws) {
            return false;
        }

        if (ws.marqueeSelection) {
            const { startBeat, endBeat, trackIds } = ws.marqueeSelection;
            deleteTimeRange(startBeat, endBeat, trackIds);
            setMarqueeSelection(null);
            return true;
        }

        const ids = ws.selectedClipIds.length > 0 ? ws.selectedClipIds : ws.selectedClipId ? [ws.selectedClipId] : [];
        if (ids.length === 0) {
            return false;
        }

        const allClips = trackStore.value?.tracks.flatMap((t) => t.clips) ?? [];
        const deletedClips = ids
            .map((id) => allClips.find((clip) => clip.id === id))
            .filter((clip): clip is NonNullable<typeof clip> => clip != null);

        if (deletedClips.length === 0) {
            return false;
        }

        pushUndoEntry(
            `Delete ${deletedClips.length} clip${deletedClips.length === 1 ? '' : 's'}`,
            () => {
                for (const clip of deletedClips) {
                    addClip(clip);
                }
            },
            () => {
                for (const clip of deletedClips) {
                    removeClip(clip.id);
                }
                clearClipSelection();
            }
        );

        for (const clip of deletedClips) {
            removeClip(clip.id);
        }
        clearClipSelection();
        return true;
    }

    function handleSimpleKeys(key: string, desc: KeyDescriptor): boolean {
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
                void eventBus.emit('zoom.scrollToPlayhead', undefined);
                return false;
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

        // All remaining shortcuts are blocked in input fields — the
        // one exception (`mod+k` → command palette) already matched
        // above via its `allowedInInput` flag.
        if (isInput) {
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
});
   };
});
