// Workspace/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

// ── Dialogs ───────────────────────────────────────────────────────────────────

export { openExportDialog, openPreferencesDialog, onDialogOpenExport, onDialogOpenPreferences } from './dialogs';

// ── Ripple Editing ────────────────────────────────────────────────────────────

export { toggleRippleEditing } from './rippleEditing';

// ── Scratch Pad ───────────────────────────────────────────────────────────────

export { getScratchPadHandlers } from './getScratchPadHandlers';

// ── Panels ────────────────────────────────────────────────────────────────────

export { showDevicePanelForType } from './panels/devicePanels';

// ── Editing Tool ──────────────────────────────────────────────────────────────

export { setEditingTool } from './setEditingTool';

// ── Track Height ──────────────────────────────────────────────────────────────

export { setTrackHeight } from './setTrackHeight';

// ── Workspace Mode ────────────────────────────────────────────────────────────

export { setWorkspaceMode } from './setWorkspaceMode';

// ── Panel Toggles ─────────────────────────────────────────────────────────────

export {
    setSoloMode,
    toggleSidebar,
    toggleInspector,
    toggleChatPanel,
    toggleMixer,
    toggleVirtualKeyboard,
    openVirtualKeyboard,
    setVirtualKeyboardOctave,
    setVirtualKeyboardVelocity,
    toggleAutomationPanel,
    toggleTrackList,
    setSnapValue,
    closeCollaborationPanel,
    closeUndoHistory,
    closeCommandPalette,
    selectClip,
    selectClipWithFocus,
    clearClipSelection,
    openMixer,
    openInspector,
    setTrackListWidth,
    closeScratchPad,
    cycleChannelStripWidth,
    toggleCollaborationPanel,
    toggleBranchManager,
    closeBranchManager,
    toggleUndoHistory,
    toggleTimeDisplayMode,
    toggleClipInSelection,
    setClipSelection,
    selectAllClips,
    toggleCommandPalette,
    toggleWorkspaceMode,
} from './togglePanel/panelToggles';

// ── Zoom Operations ───────────────────────────────────────────────────────────

export {
    zoomToFit,
    zoomToSelection,
    cycleAutomationVisibility,
    onZoomToFit,
    onZoomToSelection,
    onScrollToPlayhead,
} from './togglePanel/zoomOperations';

// ── Workspace Handlers ────────────────────────────────────────────────────────

export { getWorkspaceHandlers } from './getWorkspaceHandlers';

// ── Workspace Queries ─────────────────────────────────────────────────────────

export { gridSnapBeats, TRACK_HEIGHT_VALUES, defaultPreferences, TOOL_SHORTCUTS, getWorkspaceState } from './workspaceQueries';
export type { Preferences, GridSnapOption, WorkspaceState, EditingTool } from './workspaceQueries';

// ── Workspace State ───────────────────────────────────────────────────────────

export { updateWorkspaceState } from './workspaceState';
