import { type EditingTool } from './EditingTool';

export type WorkspaceMode = 'arrange' | 'automation' | 'clip';

export type SoloMode = 'sip' | 'afl' | 'pfl';

export type ChannelStripWidth = 'narrow' | 'normal' | 'wide';

export type TimeDisplayMode = 'musical' | 'time';

export type AutomationVisibility = 'hidden' | 'overlay' | 'panel';

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
    selectedClipId: string | null;
    selectedClipIds: string[];
    snapValue: number;
    sidebarWidth: number;
    inspectorWidth: number;
    mixerHeight: number;
    soloMode: SoloMode;
    channelStripWidth: ChannelStripWidth;
    timeDisplayMode: TimeDisplayMode;
    undoHistoryOpen: boolean;
    collaborationPanelOpen: boolean;
    chatPanelOpen: boolean;
    chatPanelWidth: number;
    rippleEditing: boolean;
    automationVisibility: AutomationVisibility;
    automationSubLanes: Record<string, string[]>; // trackId → parameterIds shown inline
    scratchPadOpen: boolean;
    scratchPadHeight: number;
    aiPanelWidth: number;
    fermenterHeight: number;
    toasterHeight: number;
    levainHeight: number;
    glutenHeight: number;
    proofChamberHeight: number;
    proofHeight: number;
    scoringHeight: number;
    yeastHeight: number;
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
    selectedClipId: null,
    selectedClipIds: [],
    snapValue: 1,
    sidebarWidth: 224,
    inspectorWidth: 256,
    mixerHeight: 208,
    soloMode: 'sip',
    channelStripWidth: 'normal',
    timeDisplayMode: 'musical',
    undoHistoryOpen: false,
    collaborationPanelOpen: false,
    chatPanelOpen: false,
    chatPanelWidth: 320,
    rippleEditing: false,
    automationVisibility: 'hidden' as AutomationVisibility,
    automationSubLanes: {},
    scratchPadOpen: false,
    scratchPadHeight: 120,
    aiPanelWidth: 340,
    fermenterHeight: 320,
    toasterHeight: 420,
    levainHeight: 340,
    glutenHeight: 300,
    proofChamberHeight: 380,
    proofHeight: 340,
    scoringHeight: 300,
    yeastHeight: 300,
};
