import { updateWorkspaceState } from '../../../repositories/updateWorkspaceState';

export const openInspector = (): void => {
    updateWorkspaceState({ inspectorOpen: true });
};
