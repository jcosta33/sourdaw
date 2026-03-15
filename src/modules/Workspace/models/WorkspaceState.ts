import type { EditingTool } from "./EditingTool";

export type WorkspaceMode = "arrange" | "clip" | "mix";

export type WorkspaceState = {
    mode: WorkspaceMode;
    sidebarOpen: boolean;
    inspectorOpen: boolean;
    mixerOpen: boolean;
    activeTool: EditingTool;
    commandPaletteOpen: boolean;
};

export const defaultWorkspaceState: WorkspaceState = {
    mode: "arrange",
    sidebarOpen: true,
    inspectorOpen: true,
    mixerOpen: false,
    activeTool: "select",
    commandPaletteOpen: false,
};
