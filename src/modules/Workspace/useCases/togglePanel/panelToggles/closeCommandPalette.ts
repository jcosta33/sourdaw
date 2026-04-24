import { updateWorkspaceState } from '../../../repositories/workspace';

export const closeCommandPalette = (): void => {
    updateWorkspaceState({ commandPaletteOpen: false });
};
