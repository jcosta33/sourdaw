import { getWorkspaceState, updateWorkspaceState } from '../../../repositories/workspace';

export function toggleCollaborationPanel(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ collaborationPanelOpen: !current.collaborationPanelOpen });
}