import { updateWorkspaceState } from '../../../repositories/workspace';

export const closeCollaborationPanel = (): void => {
    updateWorkspaceState({ collaborationPanelOpen: false });
};
