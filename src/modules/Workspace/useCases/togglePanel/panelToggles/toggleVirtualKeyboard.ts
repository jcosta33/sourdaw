import { getWorkspaceState, updateWorkspaceState } from '../../../repositories/workspace';

export function toggleVirtualKeyboard(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ virtualKeyboardOpen: !current.virtualKeyboardOpen });
}