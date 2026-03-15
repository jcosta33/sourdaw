import type { WorkspaceMode } from "../models/WorkspaceState";
import { workspaceStore } from "../stores/workspaceStore";

export const setWorkspaceMode = (mode: WorkspaceMode): void => {
    const current = workspaceStore.value;
    if (!current) return;
    workspaceStore.set({ ...current, mode });
};
