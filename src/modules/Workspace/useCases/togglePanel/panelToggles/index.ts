/**
 * Panel toggle use cases.
 *
 * §18.1 — Previously 33 individual files, each containing a single
 * 4–9 line function that forwards a property update to
 * \`updateWorkspaceState\`. The audit called this out as a passthrough
 * anti-pattern. Consolidating all 33 into one file preserves the
 * useCase-layer boundary (callers still import from
 * \`#/modules/Workspace/useCases/togglePanel/panelToggles\`) without the
 * per-field file explosion.
 *
 * The functions split into three structural groups:
 *
 *   1. **setters** — write a value unconditionally. No need to read
 *      current state. (\`openMixer\`, \`selectClip\`, \`setSnapValue\`, …)
 *   2. **boolean toggles** — read current state, write the negation of
 *      a boolean field. Built via \`createBooleanToggle(key)\`.
 *   3. **stateful transitions** — read current state and apply a
 *      non-trivial transform (cycleChannelStripWidth, toggleTimeDisplayMode,
 *      toggleWorkspaceMode, toggleClipInSelection).
 */
import { type WorkspaceState } from '../../../models/WorkspaceState';
import { getWorkspaceState, updateWorkspaceState } from '../../../repositories/workspace';
import { type ChannelStripWidth, type SoloMode } from '../../workspaceQueries/helpers';

// ── Group 1: unconditional setters ──────────────────────────────────────

export function clearClipSelection(): void {
    updateWorkspaceState({ selectedClipId: null, selectedClipIds: [] });
}

export function closeBranchManager(): void {
    updateWorkspaceState({ branchManagerOpen: false });
}

export function closeCollaborationPanel(): void {
    updateWorkspaceState({ collaborationPanelOpen: false });
}

export function closeCommandPalette(): void {
    updateWorkspaceState({ commandPaletteOpen: false });
}

export function closeScratchPad(): void {
    updateWorkspaceState({ scratchPadOpen: false });
}

export function closeUndoHistory(): void {
    updateWorkspaceState({ undoHistoryOpen: false });
}

export function openInspector(): void {
    updateWorkspaceState({ inspectorOpen: true });
}

export function openMixer(): void {
    updateWorkspaceState({ mixerOpen: true });
}

export function openVirtualKeyboard(): void {
    updateWorkspaceState({ virtualKeyboardOpen: true });
}

export function selectAllClips(getAllClipIds: () => string[]): void {
    updateWorkspaceState({ selectedClipIds: getAllClipIds(), selectedClipId: null });
}

export function selectClip(clipId: string): void {
    updateWorkspaceState({ selectedClipId: clipId });
}

export function selectClipWithFocus(clipId: string): void {
    updateWorkspaceState({ selectedClipId: clipId, selectedClipIds: [clipId] });
}

export function setClipSelection(clipIds: string[]): void {
    updateWorkspaceState({ selectedClipId: clipIds[0] ?? null, selectedClipIds: clipIds });
}

export function setSnapValue(value: number): void {
    if (!getWorkspaceState()) {
        return;
    }
    updateWorkspaceState({ snapValue: value });
}

export function setSoloMode(soloMode: SoloMode): void {
    if (!getWorkspaceState()) {
        return;
    }
    updateWorkspaceState({ soloMode });
}

export function setTrackListWidth(width: number): void {
    updateWorkspaceState({ trackListWidth: width });
}

export function setVirtualKeyboardOctave(octave: number): void {
    updateWorkspaceState({ virtualKeyboardOctave: Math.max(0, Math.min(8, octave)) });
}

export function setVirtualKeyboardVelocity(velocity: number): void {
    updateWorkspaceState({ virtualKeyboardVelocity: Math.max(1, Math.min(127, velocity)) });
}

export function setSessionViewWidth(width: number): void {
    updateWorkspaceState({ sessionViewWidth: width });
}

// ── Group 2: boolean toggles via factory ────────────────────────────────
// Each of these reads the current state, negates one boolean field,
// and writes it back. The factory centralises the read-guard logic.

type BooleanKey = {
    [K in keyof WorkspaceState]: WorkspaceState[K] extends boolean ? K : never;
}[keyof WorkspaceState];

function createBooleanToggle<Key extends BooleanKey>(key: Key): () => void {
    return () => {
        const current = getWorkspaceState();
        if (!current) {
            return;
        }
        updateWorkspaceState({ [key]: !current[key] } as Partial<WorkspaceState>);
    };
}

export const toggleAutomationPanel = createBooleanToggle('automationPanelOpen');
export const toggleBranchManager = createBooleanToggle('branchManagerOpen');
export const toggleChatPanel = createBooleanToggle('chatPanelOpen');
export const toggleCollaborationPanel = createBooleanToggle('collaborationPanelOpen');
export const toggleCommandPalette = createBooleanToggle('commandPaletteOpen');
export const toggleInspector = createBooleanToggle('inspectorOpen');
export const toggleMixer = createBooleanToggle('mixerOpen');
export const toggleSidebar = createBooleanToggle('sidebarOpen');
export const toggleTrackList = createBooleanToggle('trackListOpen');
export const toggleUndoHistory = createBooleanToggle('undoHistoryOpen');
export const toggleVirtualKeyboard = createBooleanToggle('virtualKeyboardOpen');
export const toggleDualView = createBooleanToggle('dualViewOpen');

// ── Group 3: stateful transitions ───────────────────────────────────────

const STRIP_WIDTH_CYCLE: Record<ChannelStripWidth, ChannelStripWidth> = {
    narrow: 'normal',
    normal: 'wide',
    wide: 'narrow',
};

export function cycleChannelStripWidth(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ channelStripWidth: STRIP_WIDTH_CYCLE[current.channelStripWidth] });
}

export function toggleTimeDisplayMode(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({
        timeDisplayMode: current.timeDisplayMode === 'musical' ? 'time' : 'musical',
    });
}

export function toggleWorkspaceMode(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ mode: current.mode === 'arrange' ? 'clip' : 'arrange' });
}

export function toggleClipInSelection(clipId: string): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    const ids = new Set(current.selectedClipIds);
    if (ids.has(clipId)) {
        ids.delete(clipId);
    } else {
        ids.add(clipId);
    }
    updateWorkspaceState({ selectedClipId: clipId, selectedClipIds: [...ids] });
}
