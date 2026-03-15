import { workspaceStore } from "../stores/workspaceStore";

export const toggleSidebar = (): void => {
    const current = workspaceStore.value;
    if (!current) return;
    workspaceStore.set({ ...current, sidebarOpen: !current.sidebarOpen });
};

export const toggleInspector = (): void => {
    const current = workspaceStore.value;
    if (!current) return;
    workspaceStore.set({ ...current, inspectorOpen: !current.inspectorOpen });
};

export const toggleMixer = (): void => {
    const current = workspaceStore.value;
    if (!current) return;
    workspaceStore.set({ ...current, mixerOpen: !current.mixerOpen });
};
