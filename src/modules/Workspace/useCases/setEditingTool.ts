import type { EditingTool } from "../models/EditingTool";
import { workspaceStore } from "../stores/workspaceStore";

export const setEditingTool = (tool: EditingTool): void => {
    const current = workspaceStore.value;
    if (!current) return;
    workspaceStore.set({ ...current, activeTool: tool });
};
