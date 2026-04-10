// stores/preferencesStore.ts
export { preferencesStore } from './stores/preferencesStore';

// stores/workspaceStore.ts
export { workspaceStore } from './stores/workspaceStore';

// useCases/dialogs.ts
export { openExportDialog, openPreferencesDialog, onDialogOpenExport, onDialogOpenPreferences } from './useCases/dialogs';

// useCases/rippleEditing.ts
export type { RippleDeletePlan } from './useCases/rippleEditing';
export { toggleRippleEditing, planRippleDelete, rippleDeleteClips, undoRippleDelete } from './useCases/rippleEditing';

// useCases/getScratchPadHandlers.ts
export { getScratchPadHandlers } from './useCases/getScratchPadHandlers';

// useCases/panels/devicePanels.ts
export { showDevicePanelForType } from './useCases/panels/devicePanels';

// useCases/setEditingTool.ts
export { setEditingTool } from './useCases/setEditingTool';

// useCases/setTrackHeight.ts
export { setTrackHeight } from './useCases/setTrackHeight';

// useCases/setWorkspaceMode.ts
export { setWorkspaceMode } from './useCases/setWorkspaceMode';

// useCases/togglePanel/panelToggles.ts
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
} from './useCases/togglePanel/panelToggles';

// useCases/togglePanel/zoomOperations.ts
export {
    zoomToFit,
    zoomToSelection,
    cycleAutomationVisibility,
    onZoomToFit,
    onZoomToSelection,
    onScrollToPlayhead,
} from './useCases/togglePanel/zoomOperations';

// useCases/getWorkspaceHandlers.ts
export { getWorkspaceHandlers } from './useCases/getWorkspaceHandlers';

// useCases/workspaceQueries.ts
export { gridSnapBeats, TRACK_HEIGHT_VALUES, defaultPreferences } from './useCases/workspaceQueries';
export type { Preferences, GridSnapOption, WorkspaceState, EditingTool } from './useCases/workspaceQueries';
export { TOOL_SHORTCUTS } from './useCases/workspaceQueries';
export { getWorkspaceState } from './useCases/workspaceQueries';

// useCases/workspaceState.ts
export { updateWorkspaceState } from './useCases/workspaceState';
