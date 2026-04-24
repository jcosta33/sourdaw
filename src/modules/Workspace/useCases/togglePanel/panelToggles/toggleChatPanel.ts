import { getWorkspaceState, updateWorkspaceState } from '../../../repositories/workspace';

export const toggleChatPanel = (): void => {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ chatPanelOpen: !current.chatPanelOpen });
};
