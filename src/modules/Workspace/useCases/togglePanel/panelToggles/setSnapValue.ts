import { getWorkspaceState, updateWorkspaceState } from '../../../repositories/workspace';

export const setSnapValue = (value: number): void => {
    if (!getWorkspaceState()) {
        return;
    }
    updateWorkspaceState({ snapValue: value });
};
