import { updateWorkspaceState } from '../../../repositories/workspace';

export function closeUndoHistory(): void {
    updateWorkspaceState({ undoHistoryOpen: false });
}