import { getWorkspaceState } from '../../../repositories/getWorkspaceState';
import { updateWorkspaceState } from '../../../repositories/updateWorkspaceState';

export const toggleCollaborationPanel = (): void => {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ collaborationPanelOpen: !current.collaborationPanelOpen });
};
