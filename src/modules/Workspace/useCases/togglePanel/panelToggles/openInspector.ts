import { updateWorkspaceState } from '../../../repositories/workspace';

export const openInspector = (): void => {
    updateWorkspaceState({ inspectorOpen: true });
};
