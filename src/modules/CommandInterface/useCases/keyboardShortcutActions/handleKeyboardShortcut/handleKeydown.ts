import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { clipSelectionStore, trackStore, zoomTimeline } from '#/modules/Arrangement/stores';
import {
    acceptGhostClip,
    dismissGhostClip,
    deleteTimeRange,
    executeUndoableDuplicateTimeRange,
    executeUndoableInsertTime,
    removeClip,
    addClip,
    clearClipSelection,
    selectAllClips,
    selectClipWithFocus,
    setMarqueeSelection,
} from '#/modules/Arrangement/useCases';
import { CommandEventBus, executeAppAction, pushUndoEntry, redo, undo } from '#/modules/Command/useCases';
import { loopStationStore } from '#/modules/SessionLauncher/stores';
import { stopAllSlots, triggerPad } from '#/modules/SessionLauncher/useCases';
import { panicAllNotes, stopPlayback, seekPlayhead, setLoopRegion } from '#/modules/Transport/useCases';
import { type EditingTool } from '#/modules/WorkspaceShell/stores';
import {
    cycleAutomationVisibility,
    openExportDialog,
    openPreferencesDialog,
    setEditingTool,
    showAutomationPanel,
    startToolSwap,
    toggleCommandPalette,
    toggleMixer,
    toggleTrackList,
    toggleVirtualKeyboard,
    toggleWorkspaceMode,
    TOOL_SHORTCUTS,
} from '#/modules/WorkspaceShell/useCases';

import { parseLoopStationPadCallbackId, shortcutStore, type ShortcutAction } from '../../../stores/shortcutStore';
import { getAllClipIds } from '../../selectionHelpers/getAllClipIds';
import { getLastClipEndBeat } from '../../selectionHelpers/getLastClipEndBeat';
import { goToNextMarker } from '../../selectionHelpers/goToNextMarker';
import { goToPreviousMarker } from '../../selectionHelpers/goToPreviousMarker';
import { duplicateSelectedClipsForward } from '../clipShortcuts/duplicateSelectedClipsForward';
import { duplicateTrack } from '../trackShortcuts/duplicateTrack';

const ZOOM_STEP = 4;

const AI_LEADER_TIMEOUT_MS = 1500;

type AiLeaderState = {
    armedAt: number;
};

let aiLeaderState: AiLeaderState | null = null;

function armAiLeader(): void {
    aiLeaderState = { armedAt: performance.now() };
}

function disarmAiLeader(): void {
    aiLeaderState = null;
}

function isAiLeaderArmed(): boolean {
    if (!aiLeaderState) {
        return false;
    }
    if (performance.now() - aiLeaderState.armedAt > AI_LEADER_TIMEOUT_MS) {
        aiLeaderState = null;
        return false;
    }
    return true;
}

function dispatchAiChord(key: string): boolean {
    disarmAiLeader();
    const normalized = key.toLowerCase();
    switch (normalized) {
        case 'd':
            void executeAppAction({ type: 'generateDrumPattern', payload: { style: 'rock' } });
            return true;
        case 'm':
            void executeAppAction({ type: 'generateMelody', payload: { style: 'simple' } });
            return true;
        case 'c':
            void executeAppAction({ type: 'generateChordProgression', payload: { style: 'pop' } });
            return true;
        case 'b': {
            const selectedId = clipSelectionStore.value?.selectedClipId;
            if (!selectedId) {
                return true;
            }
            void executeAppAction({ type: 'generateBassline', payload: { clipId: selectedId, style: 'root-fifth' } });
            return true;
        }
        default:
            return false;
    }
}

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
    const selectedId = clipSelectionStore.value?.selectedClipId;
    if (!selectedId) {
        return null;
    }
    const state = trackStore.value;
    const isGhost =
        (state?.ghostClips ?? []).some((g) => g.id === selectedId) ||
        state?.tracks.flatMap((time) => time.clips).some((context) => context.id === selectedId && context.isGhost);
    return isGhost ? selectedId : null;
}

function executeDuplicateTimeRange(startBeat: number, endBeat: number): void {
    const transaction = executeUndoableDuplicateTimeRange(startBeat, endBeat);
    if (!transaction) {
        return;
    }
    pushUndoEntry('Duplicate Time Range', transaction.undo, transaction.redo);
}

export const handleKeydown = inject({ eventBus: CommandEventBus })(({ eventBus }) => {
    function executeShortcutAction(action: ShortcutAction): boolean {
        if (action.type === 'appAction') {
            const appAction = action.action;

            // Handle dynamic payloads
            if (appAction.type === 'duplicateClip' && appAction.payload.clipId === 'selected') {
                // R-B4: if marquee selection exists, duplicate the time range forward (Cmd+D)
                const marq = clipSelectionStore.value?.marqueeSelection;
                if (marq && marq.endBeat > marq.startBeat) {
                    executeDuplicateTimeRange(marq.startBeat, marq.endBeat);
                    return true;
                }

                // R-B2: if multiple clips are selected, duplicate all forward by selection span
                const selectedClipIds = clipSelectionStore.value?.selectedClipIds ?? [];
                if (selectedClipIds.length > 1) {
                    duplicateSelectedClipsForward(selectedClipIds);
                } else {
                    const selectedClipId = clipSelectionStore.value?.selectedClipId;
                    if (selectedClipId) {
                        void executeAppAction({ type: 'duplicateClip', payload: { clipId: selectedClipId } });
                    }
                }
                return true;
            }
            if (appAction.type === 'duplicateClipToNextBar' && appAction.payload.clipId === 'selected') {
                const selectedClipId = clipSelectionStore.value?.selectedClipId;
                if (selectedClipId) {
                    void executeAppAction({ type: 'duplicateClipToNextBar', payload: { clipId: selectedClipId } });
                }
                return true;
            }

            void executeAppAction(action.action);
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
                    const ws = clipSelectionStore.value;
                    if (ws && (ws.selectedClipIds.length > 0 || ws.selectedClipId)) {
                        clearClipSelection();
                        return false;
                    }
                    const loopState = loopStationStore.value;
                    const hasActiveSlot = (loopState?.slots ?? []).some(
                        (slot) => slot.state === 'playing' || slot.state === 'overdubbing' || slot.state === 'recording'
                    );
                    if (hasActiveSlot) {
                        stopAllSlots();
                        return true;
                    }
                    void stopPlayback().catch((error: unknown) => {
                        logger.error(new Error('Keyboard shortcut stop request failed', { cause: error }));
                    });
                    return false;
                }
                case 'panicAllNotes': {
                    // Unconditional, unlike `stopPlayback` above: a panic must
                    // not be swallowed by a selection or a ghost clip (MD-6).
                    void panicAllNotes().catch((error: unknown) => {
                        logger.error(new Error('Keyboard shortcut MIDI panic failed', { cause: error }));
                    });
                    return true;
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
                // NOTE: no `case 'clearClipSelection'` — its only producer was
                // the `workspace.clearClipSelection` shortcut definition, which
                // was removed as a dead `Escape` alias (transport.stopPlayback
                // owns `Escape` and clears the selection first). The
                // `clearClipSelection` import is still used by the
                // `stopPlayback` case and `deleteSelectionShortcut` below.
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
                    const marq = clipSelectionStore.value?.marqueeSelection;
                    if (marq && marq.endBeat > marq.startBeat) {
                        setLoopRegion(marq.startBeat, marq.endBeat);
                        return true;
                    }
                    // R-B5: set transport loop region to the earliest start / latest end of selected clips
                    const selectedIds = clipSelectionStore.value?.selectedClipIds ?? [];
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
                        const singleId = clipSelectionStore.value?.selectedClipId;
                        if (singleId) {
                            const state = trackStore.value;
                            if (state) {
                                for (const track of state.tracks) {
                                    const clip = track.clips.find((context) => context.id === singleId);
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
                    const sel = clipSelectionStore.value?.marqueeSelection;
                    if (!sel) {
                        return false;
                    }
                    // deleteTimeRange already pushes its own undo entry
                    deleteTimeRange(sel.startBeat, sel.endBeat, sel.trackIds);
                    return true;
                }
                case 'insertSilence': {
                    // R-B4: insert silence (gap) at the time selection range
                    const sel = clipSelectionStore.value?.marqueeSelection;
                    if (!sel) {
                        return false;
                    }
                    const transaction = executeUndoableInsertTime(sel.startBeat, sel.endBeat - sel.startBeat);
                    if (!transaction) {
                        return true;
                    }
                    pushUndoEntry('Insert Silence', transaction.undo, transaction.redo);
                    return true;
                }
                case 'duplicateTimeRange': {
                    // R-B4: duplicate the time selection range forward
                    const sel = clipSelectionStore.value?.marqueeSelection;
                    if (!sel) {
                        return false;
                    }
                    executeDuplicateTimeRange(sel.startBeat, sel.endBeat);
                    return true;
                }
                case 'aiLeaderKey': {
                    armAiLeader();
                    return true;
                }
                case 'cycleGhostClipNext':
                case 'cycleGhostClipPrev': {
                    // R-E1.2: Alt+]/[ cycle through ghost clips
                    const state = trackStore.value;
                    const allGhosts = [
                        ...(state?.tracks ?? []).flatMap((time) => time.clips).filter((context) => context.isGhost),
                        ...(state?.ghostClips ?? []),
                    ].map((context) => context.id);

                    if (allGhosts.length === 0) {
                        return false;
                    }
                    const currentId = clipSelectionStore.value?.selectedClipId;
                    const currentIdx = currentId ? allGhosts.indexOf(currentId) : -1;
                    const dir = action.id === 'cycleGhostClipNext' ? 1 : -1;
                    const nextIdx = (currentIdx + dir + allGhosts.length) % allGhosts.length;
                    const nextId = allGhosts[nextIdx];
                    if (nextId) {
                        selectClipWithFocus(nextId);
                    }
                    return true;
                }
                default: {
                    const pad = parseLoopStationPadCallbackId(action.id);
                    if (pad) {
                        triggerPad({ row: pad.rowIndex, column: pad.columnIndex, record: pad.record });
                        return true;
                    }
                    return false;
                }
            }
        }
        return false;
    }

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
        const ws = clipSelectionStore.value;
        if (!ws) {
            return false;
        }

        if (ws.marqueeSelection) {
            const { startBeat, endBeat, trackIds } = ws.marqueeSelection;
            deleteTimeRange(startBeat, endBeat, trackIds);
            setMarqueeSelection(null);
            return true;
        }

        const ids = (() => {
            if (ws.selectedClipIds.length > 0) {
                return ws.selectedClipIds;
            }
            if (ws.selectedClipId) {
                return [ws.selectedClipId];
            }
            return [];
        })();
        if (ids.length === 0) {
            return false;
        }

        const allClips = trackStore.value?.tracks.flatMap((time) => time.clips) ?? [];
        const deletedClips = ids
            .map((id) => allClips.find((clip) => clip.id === id))
            .filter((clip): clip is NonNullable<typeof clip> => clip !== undefined);

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

    function handleSimpleKeys(key: string): boolean {
        // NOTE: no shortcut-store definitions loop here. The outer
        // `handleKeydown` already iterates every definition with `matches()`
        // and returns on the first match (with identical input-gating and
        // loop-station-pad gating) before delegating to `handleSimpleKeys`, so
        // a second copy of that loop could never find a match the outer loop
        // hadn't already consumed. This function only handles the keys that
        // have no shortcut-store definition (`Home`, `End`, `[`, `]`, the
        // numeric / letter tool selectors, and the `L` scroll-to-playhead).
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
    }

    return function handleKeydown(desc: KeyDescriptor): boolean {
        const { key, mod, shift, alt, repeat, isInput } = desc;

        // AI leader chord resolution — if `g` was pressed recently and this
        // keypress is a bare letter (no modifiers), consume it as the second
        // stroke of `g, <letter>`.
        if (isAiLeaderArmed() && !mod && !shift && !alt && !repeat && !isInput && key.length === 1) {
            if (dispatchAiChord(key)) {
                return true;
            }
            disarmAiLeader();
        }

        // V has no keyboard voice-admission path. Microphone start accepts
        // only the one-use token issued from the voice control's trusted UI event.
        if (key === 'v' && !mod && !shift && !alt && !repeat) {
            if (isInput) {
                return false;
            }
            return false;
        }

        // Check shortcut store first for ALL keys (including those with modifiers)
        const { definitions, customMappings } = shortcutStore.value ?? {
            definitions: [],
            customMappings: {},
        };
        const loopStationArmed = loopStationStore.value?.armed === true;
        for (const def of definitions) {
            const keys = customMappings[def.id] ?? def.defaultKeys;
            if (matches(desc, keys)) {
                // Some shortcuts (like Cmd+K) should work even in inputs
                const allowedInInput = def.id === 'workspace.toggleCommandPalette';
                if (isInput && !allowedInInput) {
                    continue;
                }
                // Gate Loop Station play-pad shortcuts behind the `armed`
                // toggle so they don't steal letter keys from existing
                // transport / tool bindings. Shift-press record variants
                // always fire — they carry a shift modifier that otherwise
                // has no binding, so there is no conflict to gate against.
                if (def.id.startsWith('loopStation.pad.') && def.id.endsWith('.play') && !loopStationArmed) {
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
            startToolSwap({
                key,
                timestamp: performance.now(),
                tool,
            });
        }

        return handleSimpleKeys(key);
    };
});
