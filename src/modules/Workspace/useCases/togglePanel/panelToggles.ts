import { inject } from '#/infra/di/inject';
import { getWorkspaceState, updateWorkspaceState } from '../../repositories/workspace';
import { type SoloMode, type ChannelStripWidth } from '../../models/WorkspaceState';

const STRIP_WIDTH_CYCLE: Record<ChannelStripWidth, ChannelStripWidth> = {
    narrow: 'normal',
    normal: 'wide',
    wide: 'narrow',
};

export const setSoloMode = inject({ getWorkspaceState, updateWorkspaceState })(
    ({ getWorkspaceState, updateWorkspaceState }) =>
        function setSoloMode(soloMode: SoloMode): void {
            const current = getWorkspaceState();
            if (!current) {
                return;
            }
            updateWorkspaceState({ soloMode });
        }
);

export const toggleSidebar = inject({ getWorkspaceState, updateWorkspaceState })(
    ({ getWorkspaceState, updateWorkspaceState }) =>
        function toggleSidebar(): void {
            const current = getWorkspaceState();
            if (!current) {
                return;
            }
            updateWorkspaceState({ sidebarOpen: !current.sidebarOpen });
        }
);

export const toggleInspector = inject({ getWorkspaceState, updateWorkspaceState })(
    ({ getWorkspaceState, updateWorkspaceState }) =>
        function toggleInspector(): void {
            const current = getWorkspaceState();
            if (!current) {
                return;
            }
            updateWorkspaceState({ inspectorOpen: !current.inspectorOpen });
        }
);

export const toggleChatPanel = inject({ getWorkspaceState, updateWorkspaceState })(
    ({ getWorkspaceState, updateWorkspaceState }) =>
        function toggleChatPanel(): void {
            const current = getWorkspaceState();
            if (!current) {
                return;
            }
            updateWorkspaceState({ chatPanelOpen: !current.chatPanelOpen });
        }
);

export const toggleMixer = inject({ getWorkspaceState, updateWorkspaceState })(
    ({ getWorkspaceState, updateWorkspaceState }) =>
        function toggleMixer(): void {
            const current = getWorkspaceState();
            if (!current) {
                return;
            }
            updateWorkspaceState({ mixerOpen: !current.mixerOpen });
        }
);

export const toggleVirtualKeyboard = inject({ getWorkspaceState, updateWorkspaceState })(
    ({ getWorkspaceState, updateWorkspaceState }) =>
        function toggleVirtualKeyboard(): void {
            const current = getWorkspaceState();
            if (!current) {
                return;
            }
            updateWorkspaceState({ virtualKeyboardOpen: !current.virtualKeyboardOpen });
        }
);

export const openVirtualKeyboard = inject({ updateWorkspaceState })(
    ({ updateWorkspaceState }) =>
        function openVirtualKeyboard(): void {
            updateWorkspaceState({ virtualKeyboardOpen: true });
        }
);

export const setVirtualKeyboardOctave = inject({ updateWorkspaceState })(
    ({ updateWorkspaceState }) =>
        function setVirtualKeyboardOctave(octave: number): void {
            updateWorkspaceState({ virtualKeyboardOctave: Math.max(0, Math.min(8, octave)) });
        }
);

export const setVirtualKeyboardVelocity = inject({ updateWorkspaceState })(
    ({ updateWorkspaceState }) =>
        function setVirtualKeyboardVelocity(velocity: number): void {
            updateWorkspaceState({ virtualKeyboardVelocity: Math.max(1, Math.min(127, velocity)) });
        }
);

export const toggleAutomationPanel = inject({ getWorkspaceState, updateWorkspaceState })(
    ({ getWorkspaceState, updateWorkspaceState }) =>
        function toggleAutomationPanel(): void {
            const current = getWorkspaceState();
            if (!current) {
                return;
            }
            updateWorkspaceState({ automationPanelOpen: !current.automationPanelOpen });
        }
);

export const toggleTrackList = inject({ getWorkspaceState, updateWorkspaceState })(
    ({ getWorkspaceState, updateWorkspaceState }) =>
        function toggleTrackList(): void {
            const current = getWorkspaceState();
            if (!current) {
                return;
            }
            updateWorkspaceState({ trackListOpen: !current.trackListOpen });
        }
);

export const setSnapValue = inject({ getWorkspaceState, updateWorkspaceState })(
    ({ getWorkspaceState, updateWorkspaceState }) =>
        function setSnapValue(value: number): void {
            const current = getWorkspaceState();
            if (!current) {
                return;
            }
            updateWorkspaceState({ snapValue: value });
        }
);

export const closeCollaborationPanel = inject({ updateWorkspaceState })(
    ({ updateWorkspaceState }) =>
        function closeCollaborationPanel(): void {
            updateWorkspaceState({ collaborationPanelOpen: false });
        }
);

export const closeUndoHistory = inject({ updateWorkspaceState })(
    ({ updateWorkspaceState }) =>
        function closeUndoHistory(): void {
            updateWorkspaceState({ undoHistoryOpen: false });
        }
);

export const closeCommandPalette = inject({ updateWorkspaceState })(
    ({ updateWorkspaceState }) =>
        function closeCommandPalette(): void {
            updateWorkspaceState({ commandPaletteOpen: false });
        }
);

export const selectClip = inject({ updateWorkspaceState })(
    ({ updateWorkspaceState }) =>
        function selectClip(clipId: string): void {
            updateWorkspaceState({ selectedClipId: clipId });
        }
);

export const selectClipWithFocus = inject({ updateWorkspaceState })(
    ({ updateWorkspaceState }) =>
        function selectClipWithFocus(clipId: string): void {
            updateWorkspaceState({ selectedClipId: clipId, selectedClipIds: [clipId] });
        }
);

export const clearClipSelection = inject({ updateWorkspaceState })(
    ({ updateWorkspaceState }) =>
        function clearClipSelection(): void {
            updateWorkspaceState({ selectedClipId: null, selectedClipIds: [] });
        }
);

export const openMixer = inject({ updateWorkspaceState })(
    ({ updateWorkspaceState }) =>
        function openMixer(): void {
            updateWorkspaceState({ mixerOpen: true });
        }
);

export const openInspector = inject({ updateWorkspaceState })(
    ({ updateWorkspaceState }) =>
        function openInspector(): void {
            updateWorkspaceState({ inspectorOpen: true });
        }
);

export const setTrackListWidth = inject({ updateWorkspaceState })(
    ({ updateWorkspaceState }) =>
        function setTrackListWidth(width: number): void {
            updateWorkspaceState({ trackListWidth: width });
        }
);

export const closeScratchPad = inject({ updateWorkspaceState })(
    ({ updateWorkspaceState }) =>
        function closeScratchPad(): void {
            updateWorkspaceState({ scratchPadOpen: false });
        }
);

export const cycleChannelStripWidth = inject({ getWorkspaceState, updateWorkspaceState })(
    ({ getWorkspaceState, updateWorkspaceState }) =>
        function cycleChannelStripWidth(): void {
            const current = getWorkspaceState();
            if (!current) {
                return;
            }
            updateWorkspaceState({ channelStripWidth: STRIP_WIDTH_CYCLE[current.channelStripWidth] });
        }
);

export const toggleCollaborationPanel = inject({ getWorkspaceState, updateWorkspaceState })(
    ({ getWorkspaceState, updateWorkspaceState }) =>
        function toggleCollaborationPanel(): void {
            const current = getWorkspaceState();
            if (!current) {
                return;
            }
            updateWorkspaceState({ collaborationPanelOpen: !current.collaborationPanelOpen });
        }
);

export const toggleBranchManager = inject({ getWorkspaceState, updateWorkspaceState })(
    ({ getWorkspaceState, updateWorkspaceState }) =>
        function toggleBranchManager(): void {
            const current = getWorkspaceState();
            if (!current) {
                return;
            }
            updateWorkspaceState({ branchManagerOpen: !current.branchManagerOpen });
        }
);

export const closeBranchManager = inject({ updateWorkspaceState })(
    ({ updateWorkspaceState }) =>
        function closeBranchManager(): void {
            updateWorkspaceState({ branchManagerOpen: false });
        }
);

export const toggleUndoHistory = inject({ getWorkspaceState, updateWorkspaceState })(
    ({ getWorkspaceState, updateWorkspaceState }) =>
        function toggleUndoHistory(): void {
            const current = getWorkspaceState();
            if (!current) {
                return;
            }
            updateWorkspaceState({ undoHistoryOpen: !current.undoHistoryOpen });
        }
);

export const toggleTimeDisplayMode = inject({ getWorkspaceState, updateWorkspaceState })(
    ({ getWorkspaceState, updateWorkspaceState }) =>
        function toggleTimeDisplayMode(): void {
            const current = getWorkspaceState();
            if (!current) {
                return;
            }
            updateWorkspaceState({
                timeDisplayMode: current.timeDisplayMode === 'musical' ? 'time' : 'musical',
            });
        }
);

export const toggleClipInSelection = inject({ getWorkspaceState, updateWorkspaceState })(
    ({ getWorkspaceState, updateWorkspaceState }) =>
        function toggleClipInSelection(clipId: string): void {
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
);

export const setClipSelection = inject({ updateWorkspaceState })(
    ({ updateWorkspaceState }) =>
        function setClipSelection(clipIds: string[]): void {
            updateWorkspaceState({ selectedClipId: clipIds[0] ?? null, selectedClipIds: clipIds });
        }
);

export const selectAllClips = inject({ updateWorkspaceState })(
    ({ updateWorkspaceState }) =>
        function selectAllClips(getAllClipIds: () => string[]): void {
            updateWorkspaceState({ selectedClipIds: getAllClipIds(), selectedClipId: null });
        }
);

export const toggleCommandPalette = inject({ getWorkspaceState, updateWorkspaceState })(
    ({ getWorkspaceState, updateWorkspaceState }) =>
        function toggleCommandPalette(): void {
            const current = getWorkspaceState();
            if (!current) {
                return;
            }
            updateWorkspaceState({ commandPaletteOpen: !current.commandPaletteOpen });
        }
);

export const toggleWorkspaceMode = inject({ getWorkspaceState, updateWorkspaceState })(
    ({ getWorkspaceState, updateWorkspaceState }) =>
        function toggleWorkspaceMode(): void {
            const current = getWorkspaceState();
            if (!current) {
                return;
            }
            updateWorkspaceState({ mode: current.mode === 'arrange' ? 'clip' : 'arrange' });
        }
);
