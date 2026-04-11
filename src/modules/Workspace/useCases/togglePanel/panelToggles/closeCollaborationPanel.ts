import { updateWorkspaceState } from '../../../repositories/workspace';

export function closeCollaborationPanel(): void {
    updateWorkspaceState({ collaborationPanelOpen: false });
}