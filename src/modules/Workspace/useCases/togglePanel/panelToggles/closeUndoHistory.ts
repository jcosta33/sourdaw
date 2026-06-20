import { updateWorkspaceState } from '../../../repositories/updateWorkspaceState';

export const closeUndoHistory = (): void => {
    updateWorkspaceState({ undoHistoryOpen: false });
};
