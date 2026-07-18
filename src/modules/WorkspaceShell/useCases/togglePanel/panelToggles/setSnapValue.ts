import { getWorkspaceState } from '../../../repositories/getWorkspaceState';
import { updateWorkspaceState } from '../../../repositories/updateWorkspaceState';

export const setSnapValue = (value: number): void => {
    if (!getWorkspaceState()) {
        return;
    }
    updateWorkspaceState({ snapValue: value });
};
