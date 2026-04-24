import { getWorkspaceState, updateWorkspaceState } from '../../../repositories/workspace';

export const toggleSidebar = (): void => {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ sidebarOpen: !current.sidebarOpen });
};
