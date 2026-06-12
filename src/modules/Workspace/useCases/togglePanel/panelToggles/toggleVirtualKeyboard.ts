import { getWorkspaceState, updateWorkspaceState } from '../../../repositories/workspace';

export const toggleVirtualKeyboard = (): void => {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ virtualKeyboardOpen: !current.virtualKeyboardOpen });
};
