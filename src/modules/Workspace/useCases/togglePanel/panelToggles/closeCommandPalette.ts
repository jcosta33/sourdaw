import { updateWorkspaceState } from '../../../repositories/updateWorkspaceState';

export const closeCommandPalette = (): void => {
    updateWorkspaceState({ commandPaletteOpen: false });
};
