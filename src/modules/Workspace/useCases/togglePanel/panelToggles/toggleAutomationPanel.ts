import { getWorkspaceState, updateWorkspaceState } from '../../../repositories/workspace';

export function toggleAutomationPanel(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ automationPanelOpen: !current.automationPanelOpen });
}