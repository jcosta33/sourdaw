import type { EditingTool } from "./EditingTool";

export type WorkspaceMode = "arrange" | "clip" | "mix";

export type SoloMode = "sip" | "afl" | "pfl";

export type ChannelStripWidth = "narrow" | "normal" | "wide";

export type TimeDisplayMode = "musical" | "time";

export type WorkspaceState = {
    mode: WorkspaceMode;
    sidebarOpen: boolean;
    inspectorOpen: boolean;
    mixerOpen: boolean;
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
};

export const defaultWorkspaceState: WorkspaceState = {
    mode: "arrange",
    sidebarOpen: true,
    inspectorOpen: true,
    mixerOpen: false,
    activeTool: "select",
    commandPaletteOpen: false,
    selectedClipId: null,
    selectedClipIds: [],
    snapValue: 1,
    sidebarWidth: 224,
    inspectorWidth: 256,
    mixerHeight: 208,
    soloMode: "sip",
    channelStripWidth: "normal",
    timeDisplayMode: "musical",
    undoHistoryOpen: false,
    collaborationPanelOpen: false,
};
