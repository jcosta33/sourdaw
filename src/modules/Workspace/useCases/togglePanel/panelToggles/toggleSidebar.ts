import { getWorkspaceState, updateWorkspaceState } from '../../../repositories/workspace';

export function toggleSidebar(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ sidebarOpen: !current.sidebarOpen });
}