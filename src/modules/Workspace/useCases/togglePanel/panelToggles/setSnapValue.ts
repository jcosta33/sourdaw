import { getWorkspaceState, updateWorkspaceState } from '../../../repositories/workspace';

export function setSnapValue(value: number): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ snapValue: value });
}