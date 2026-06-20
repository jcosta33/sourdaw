import { updateWorkspaceState } from '../../../repositories/updateWorkspaceState';

export const closeCollaborationPanel = (): void => {
    updateWorkspaceState({ collaborationPanelOpen: false });
};
