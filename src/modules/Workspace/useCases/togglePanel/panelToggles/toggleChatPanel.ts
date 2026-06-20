import { getWorkspaceState } from '../../../repositories/getWorkspaceState';
import { updateWorkspaceState } from '../../../repositories/updateWorkspaceState';

export const toggleChatPanel = (): void => {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ chatPanelOpen: !current.chatPanelOpen });
};
