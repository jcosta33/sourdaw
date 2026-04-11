import { updateWorkspaceState } from '../../../repositories/workspace';

export function openVirtualKeyboard(): void {
    updateWorkspaceState({ virtualKeyboardOpen: true });
}