import { updateWorkspaceState } from '../../../repositories/workspace';

export const openVirtualKeyboard = (): void => {
    updateWorkspaceState({ virtualKeyboardOpen: true });
};
