export { openExportDialog } from './dialogs/openExportDialog';
export { openPreferencesDialog } from './dialogs/openPreferencesDialog';
export { dismissAlphaNotice } from './dismissAlphaNotice';
export { setWorkspaceEventBus } from './workspaceEventBus';

// ── Scratch Pad ───────────────────────────────────────────────────────────────

export { getScratchPadHandlers } from './getScratchPadHandlers';

export { showAutomationPanel } from './panels/devicePanels/showAutomationPanel';
export { showDevicePanelForType } from './panels/devicePanels/showDevicePanelForType';

// ── Editing Tool ──────────────────────────────────────────────────────────────

export { finishToolSwap } from './finishToolSwap';
export { setEditingTool } from './setEditingTool';
export { startToolSwap } from './startToolSwap';

// ── Workspace Mode ────────────────────────────────────────────────────────────

export { setWorkspaceMode } from './setWorkspaceMode';

export { closeCollaborationPanel } from './togglePanel/panelToggles/closeCollaborationPanel';
export { closeCommandPalette } from './togglePanel/panelToggles/closeCommandPalette';
export { closeUndoHistory } from './togglePanel/panelToggles/closeUndoHistory';
export { setSoloMode } from './togglePanel/panelToggles/setSoloMode';
export { setVirtualKeyboardOctave } from './togglePanel/panelToggles/setVirtualKeyboardOctave';
export { setVirtualKeyboardVelocity } from './togglePanel/panelToggles/setVirtualKeyboardVelocity';
export { toggleAutomationPanel } from './togglePanel/panelToggles/toggleAutomationPanel';
export { toggleBranchManager } from './togglePanel/panelToggles/toggleBranchManager';
export { toggleChatPanel } from './togglePanel/panelToggles/toggleChatPanel';
export { toggleCommandPalette } from './togglePanel/panelToggles/toggleCommandPalette';
export { toggleInspector } from './togglePanel/panelToggles/toggleInspector';
export { toggleMixer } from './togglePanel/panelToggles/toggleMixer';
export { toggleSidebar } from './togglePanel/panelToggles/toggleSidebar';
export { toggleTrackList } from './togglePanel/panelToggles/toggleTrackList';
export { toggleVirtualKeyboard } from './togglePanel/panelToggles/toggleVirtualKeyboard';
export { toggleWorkspaceMode } from './togglePanel/panelToggles/toggleWorkspaceMode';
export { openInspector } from './togglePanel/panelToggles/openInspector';
export { cycleChannelStripWidth } from './togglePanel/panelToggles/cycleChannelStripWidth';
export { closeScratchPad } from './togglePanel/panelToggles/closeScratchPad';
export { setSessionViewWidth } from './togglePanel/panelToggles/setSessionViewWidth';
export { setTrackListWidth } from './togglePanel/panelToggles/setTrackListWidth';

export { zoomToFit } from './togglePanel/zoomOperations/zoomToFit';
export { zoomToSelection } from './togglePanel/zoomOperations/zoomToSelection';
export { cycleAutomationVisibility } from './togglePanel/zoomOperations/cycleAutomationVisibility';
export { onZoomToFit } from './togglePanel/zoomOperations/onZoomToFit';
export { onZoomToSelection } from './togglePanel/zoomOperations/onZoomToSelection';
export { onScrollToPlayhead } from './togglePanel/zoomOperations/onScrollToPlayhead';

// ── Workspace Handlers ────────────────────────────────────────────────────────

export { getWorkspaceHandlers } from './getWorkspaceHandlers';

export { TOOL_SHORTCUTS } from './workspaceQueries/helpers';
// Public state/preferences TYPES are exported from the `stores/` barrel (next to
// the stores that hold them), not here — the `useCases/` contract barrel must not
// re-export types (arch rule `no-usecase-type-exports-on-index`).

// ── Workspace State ───────────────────────────────────────────────────────────

export { toggleRippleEditing } from './rippleEditing';
export { updateWorkspaceState } from './workspaceState';

// ── Window Chrome ─────────────────────────────────────────────────────────────

export { windowChromeControls } from './windowChrome';
