import { getWorkspaceState, updateWorkspaceState } from '../../repositories/workspace';
import { type SoloMode, type ChannelStripWidth } from '../workspaceQueries';

const STRIP_WIDTH_CYCLE: Record<ChannelStripWidth, ChannelStripWidth> = {
    narrow: 'normal',
    normal: 'wide',
    wide: 'narrow',
};

export function setSoloMode(soloMode: SoloMode): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ soloMode });
}

export function toggleSidebar(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ sidebarOpen: !current.sidebarOpen });
}

export function toggleInspector(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ inspectorOpen: !current.inspectorOpen });
}

export function toggleChatPanel(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ chatPanelOpen: !current.chatPanelOpen });
}

export function toggleMixer(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ mixerOpen: !current.mixerOpen });
}

export function toggleVirtualKeyboard(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ virtualKeyboardOpen: !current.virtualKeyboardOpen });
}

export function openVirtualKeyboard(): void {
    updateWorkspaceState({ virtualKeyboardOpen: true });
}

export function setVirtualKeyboardOctave(octave: number): void {
    updateWorkspaceState({ virtualKeyboardOctave: Math.max(0, Math.min(8, octave)) });
}

export function setVirtualKeyboardVelocity(velocity: number): void {
    updateWorkspaceState({ virtualKeyboardVelocity: Math.max(1, Math.min(127, velocity)) });
}

export function toggleAutomationPanel(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ automationPanelOpen: !current.automationPanelOpen });
}

export function toggleTrackList(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ trackListOpen: !current.trackListOpen });
}

export function setSnapValue(value: number): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ snapValue: value });
}

export function closeCollaborationPanel(): void {
    updateWorkspaceState({ collaborationPanelOpen: false });
}

export function closeUndoHistory(): void {
    updateWorkspaceState({ undoHistoryOpen: false });
}

export function closeCommandPalette(): void {
    updateWorkspaceState({ commandPaletteOpen: false });
}

export function selectClip(clipId: string): void {
    updateWorkspaceState({ selectedClipId: clipId });
}

export function selectClipWithFocus(clipId: string): void {
    updateWorkspaceState({ selectedClipId: clipId, selectedClipIds: [clipId] });
}

export function clearClipSelection(): void {
    updateWorkspaceState({ selectedClipId: null, selectedClipIds: [] });
}

export function openMixer(): void {
    updateWorkspaceState({ mixerOpen: true });
}

export function openInspector(): void {
    updateWorkspaceState({ inspectorOpen: true });
}

export function setTrackListWidth(width: number): void {
    updateWorkspaceState({ trackListWidth: width });
}

export function closeScratchPad(): void {
    updateWorkspaceState({ scratchPadOpen: false });
}

export function cycleChannelStripWidth(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ channelStripWidth: STRIP_WIDTH_CYCLE[current.channelStripWidth] });
}

export function toggleCollaborationPanel(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ collaborationPanelOpen: !current.collaborationPanelOpen });
}

export function toggleBranchManager(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ branchManagerOpen: !current.branchManagerOpen });
}

export function closeBranchManager(): void {
    updateWorkspaceState({ branchManagerOpen: false });
}

export function toggleUndoHistory(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ undoHistoryOpen: !current.undoHistoryOpen });
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

export function setClipSelection(clipIds: string[]): void {
    updateWorkspaceState({ selectedClipId: clipIds[0] ?? null, selectedClipIds: clipIds });
}

export function selectAllClips(getAllClipIds: () => string[]): void {
    updateWorkspaceState({ selectedClipIds: getAllClipIds(), selectedClipId: null });
}

export function toggleCommandPalette(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ commandPaletteOpen: !current.commandPaletteOpen });
}

export function toggleWorkspaceMode(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ mode: current.mode === 'arrange' ? 'clip' : 'arrange' });
}
