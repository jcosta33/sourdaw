export { openExportDialog } from './dialogs/openExportDialog';
export { openPreferencesDialog } from './dialogs/openPreferencesDialog';
export { onDialogOpenExport } from './dialogs/onDialogOpenExport';
export { onDialogOpenPreferences } from './dialogs/onDialogOpenPreferences';

// ── Ripple Editing ────────────────────────────────────────────────────────────

export { toggleRippleEditing } from './rippleEditing';

// ── Scratch Pad ───────────────────────────────────────────────────────────────

export { getScratchPadHandlers } from './getScratchPadHandlers';

export { showDevicePanelForType } from './panels/devicePanels/showDevicePanelForType';
export { showAutomationPanel } from './panels/devicePanels/showAutomationPanel';

// ── Editing Tool ──────────────────────────────────────────────────────────────

export { setEditingTool } from './setEditingTool';
export { setMarqueeSelection } from './setMarqueeSelection';

// ── Track Height ──────────────────────────────────────────────────────────────

export { setTrackHeight } from './setTrackHeight';

// ── Workspace Mode ────────────────────────────────────────────────────────────

export { setWorkspaceMode } from './setWorkspaceMode';

export {
    clearClipSelection,
    closeBranchManager,
    closeCollaborationPanel,
    closeCommandPalette,
    closeScratchPad,
    closeUndoHistory,
    cycleChannelStripWidth,
    openInspector,
    openMixer,
    openVirtualKeyboard,
    selectAllClips,
    selectClip,
    selectClipWithFocus,
    setClipSelection,
    setSnapValue,
    setSoloMode,
    setTrackListWidth,
    setVirtualKeyboardOctave,
    setVirtualKeyboardVelocity,
    toggleAutomationPanel,
    toggleBranchManager,
    toggleChatPanel,
    toggleClipInSelection,
    toggleCollaborationPanel,
    toggleCommandPalette,
    toggleInspector,
    toggleMixer,
    toggleSidebar,
    toggleTimeDisplayMode,
    toggleTrackList,
    toggleUndoHistory,
    toggleVirtualKeyboard,
    toggleWorkspaceMode,
} from './togglePanel/panelToggles';

export { zoomToFit } from './togglePanel/zoomOperations/zoomToFit';
export { zoomToSelection } from './togglePanel/zoomOperations/zoomToSelection';
export { cycleAutomationVisibility } from './togglePanel/zoomOperations/cycleAutomationVisibility';
export { onZoomToFit } from './togglePanel/zoomOperations/onZoomToFit';
export { onZoomToSelection } from './togglePanel/zoomOperations/onZoomToSelection';
export { onScrollToPlayhead } from './togglePanel/zoomOperations/onScrollToPlayhead';

// ── Workspace Handlers ────────────────────────────────────────────────────────

export { getWorkspaceHandlers } from './getWorkspaceHandlers';

export { gridSnapBeats } from './workspaceQueries/gridSnapBeats';
export { TRACK_HEIGHT_VALUES, defaultPreferences, TOOL_SHORTCUTS } from './workspaceQueries/helpers';
export { getWorkspaceState } from './workspaceQueries/getWorkspaceState';
export type { Preferences, GridSnapOption, WorkspaceState, EditingTool } from './workspaceQueries/helpers';

// ── Workspace State ───────────────────────────────────────────────────────────

export { updateWorkspaceState } from './workspaceState';
