import { getWorkspaceState, updateWorkspaceState } from '../../../repositories/workspace';

export function toggleChatPanel(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ chatPanelOpen: !current.chatPanelOpen });
}