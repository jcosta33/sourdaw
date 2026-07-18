import { updateWorkspaceState } from '../../../repositories/updateWorkspaceState';

export const openVirtualKeyboard = (): void => {
    updateWorkspaceState({ virtualKeyboardOpen: true });
};
