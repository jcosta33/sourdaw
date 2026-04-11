export { openExportDialog } from './dialogs/openExportDialog';
export { openPreferencesDialog } from './dialogs/openPreferencesDialog';
export { onDialogOpenExport } from './dialogs/onDialogOpenExport';
export { onDialogOpenPreferences } from './dialogs/onDialogOpenPreferences';

// ── Ripple Editing ────────────────────────────────────────────────────────────

export { toggleRippleEditing } from './rippleEditing';

// ── Scratch Pad ───────────────────────────────────────────────────────────────

export { getScratchPadHandlers } from './getScratchPadHandlers';

export { showDevicePanelForType } from './panels/devicePanels/showDevicePanelForType';

// ── Editing Tool ──────────────────────────────────────────────────────────────

export { setEditingTool } from './setEditingTool';

// ── Track Height ──────────────────────────────────────────────────────────────

export { setTrackHeight } from './setTrackHeight';

// ── Workspace Mode ────────────────────────────────────────────────────────────

export { setWorkspaceMode } from './setWorkspaceMode';

export { setSoloMode } from './togglePanel/panelToggles/setSoloMode';
export { toggleSidebar } from './togglePanel/panelToggles/toggleSidebar';
export { toggleInspector } from './togglePanel/panelToggles/toggleInspector';
export { toggleChatPanel } from './togglePanel/panelToggles/toggleChatPanel';
export { toggleMixer } from './togglePanel/panelToggles/toggleMixer';
export { toggleVirtualKeyboard } from './togglePanel/panelToggles/toggleVirtualKeyboard';
export { openVirtualKeyboard } from './togglePanel/panelToggles/openVirtualKeyboard';
export { setVirtualKeyboardOctave } from './togglePanel/panelToggles/setVirtualKeyboardOctave';
export { setVirtualKeyboardVelocity } from './togglePanel/panelToggles/setVirtualKeyboardVelocity';
export { toggleAutomationPanel } from './togglePanel/panelToggles/toggleAutomationPanel';
export { toggleTrackList } from './togglePanel/panelToggles/toggleTrackList';
export { setSnapValue } from './togglePanel/panelToggles/setSnapValue';
export { closeCollaborationPanel } from './togglePanel/panelToggles/closeCollaborationPanel';
export { closeUndoHistory } from './togglePanel/panelToggles/closeUndoHistory';
export { closeCommandPalette } from './togglePanel/panelToggles/closeCommandPalette';
export { selectClip } from './togglePanel/panelToggles/selectClip';
export { selectClipWithFocus } from './togglePanel/panelToggles/selectClipWithFocus';
export { clearClipSelection } from './togglePanel/panelToggles/clearClipSelection';
export { openMixer } from './togglePanel/panelToggles/openMixer';
export { openInspector } from './togglePanel/panelToggles/openInspector';
export { setTrackListWidth } from './togglePanel/panelToggles/setTrackListWidth';
export { closeScratchPad } from './togglePanel/panelToggles/closeScratchPad';
export { cycleChannelStripWidth } from './togglePanel/panelToggles/cycleChannelStripWidth';
export { toggleCollaborationPanel } from './togglePanel/panelToggles/toggleCollaborationPanel';
export { toggleBranchManager } from './togglePanel/panelToggles/toggleBranchManager';
export { closeBranchManager } from './togglePanel/panelToggles/closeBranchManager';
export { toggleUndoHistory } from './togglePanel/panelToggles/toggleUndoHistory';
export { toggleTimeDisplayMode } from './togglePanel/panelToggles/toggleTimeDisplayMode';
export { toggleClipInSelection } from './togglePanel/panelToggles/toggleClipInSelection';
export { setClipSelection } from './togglePanel/panelToggles/setClipSelection';
export { selectAllClips } from './togglePanel/panelToggles/selectAllClips';
export { toggleCommandPalette } from './togglePanel/panelToggles/toggleCommandPalette';
export { toggleWorkspaceMode } from './togglePanel/panelToggles/toggleWorkspaceMode';

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
