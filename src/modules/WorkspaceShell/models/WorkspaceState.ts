import { type EditingTool } from './EditingTool';

export type WorkspaceMode = 'arrange' | 'automation' | 'clip';

export type ChannelStripWidth = 'narrow' | 'normal' | 'wide';

export type TimeDisplayMode = 'musical' | 'time';

export type WorkspaceState = {
    mode: WorkspaceMode;
    sidebarOpen: boolean;
    inspectorOpen: boolean;
    mixerOpen: boolean;
    automationPanelOpen: boolean;
    automationPanelWidth: number;
    trackListOpen: boolean;
    trackListWidth: number;
    activeTool: EditingTool;
    commandPaletteOpen: boolean;
    sidebarWidth: number;
    inspectorWidth: number;
    mixerHeight: number;
    editorHeight: number;
    channelStripWidth: ChannelStripWidth;
    timeDisplayMode: TimeDisplayMode;
    undoHistoryOpen: boolean;
    collaborationPanelOpen: boolean;
    branchManagerOpen: boolean;
    chatPanelOpen: boolean;
    chatPanelWidth: number;
    /** D1: Toggle for Session + Arrangement side-by-side view. */
    dualViewOpen: boolean;
    /** D1: Width of the Session view in dual mode. */
    sessionViewWidth: number;
    scratchPadOpen: boolean;
    scratchPadHeight: number;
    /** The pad shows only its header strip. Session UI state; reset whenever the pad opens or closes. */
    scratchPadCollapsed: boolean;
    /**
     * Height of the timeline minimap while its resize handle is being dragged, before the
     * height is committed to preferences. Null when no drag is in progress. Published by
     * the arrangement so the shell's arrangement floor follows what is rendered.
     */
    timelineMinimapPreviewHeight: number | null;
    aiPanelWidth: number;
    virtualKeyboardOpen: boolean;
    virtualKeyboardOctave: number;
    virtualKeyboardHeight: number;
    virtualKeyboardVelocity: number;
};

export const defaultWorkspaceState: WorkspaceState = {
    mode: 'arrange',
    sidebarOpen: true,
    inspectorOpen: true,
    mixerOpen: false,
    automationPanelOpen: false,
    automationPanelWidth: 400,
    trackListOpen: true,
    trackListWidth: 220,
    activeTool: 'select',
    commandPaletteOpen: false,
    sidebarWidth: 224,
    inspectorWidth: 256,
    mixerHeight: 208,
    editorHeight: 360,
    channelStripWidth: 'normal',
    timeDisplayMode: 'musical',
    undoHistoryOpen: false,
    collaborationPanelOpen: false,
    branchManagerOpen: false,
    chatPanelOpen: false,
    chatPanelWidth: 320,
    dualViewOpen: false,
    sessionViewWidth: 320,
    scratchPadOpen: false,
    scratchPadHeight: 120,
    scratchPadCollapsed: false,
    timelineMinimapPreviewHeight: null,
    aiPanelWidth: 340,
    virtualKeyboardOpen: false,
    virtualKeyboardOctave: 4,
    virtualKeyboardHeight: 128,
    virtualKeyboardVelocity: 100,
};
