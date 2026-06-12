import { getWorkspaceState, updateWorkspaceState } from '../../../repositories/workspace';

export const toggleCommandPalette = (): void => {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ commandPaletteOpen: !current.commandPaletteOpen });
};
