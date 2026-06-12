import { updateWorkspaceState } from '../../../repositories/workspace';

export const closeUndoHistory = (): void => {
    updateWorkspaceState({ undoHistoryOpen: false });
};
