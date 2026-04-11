import { updateWorkspaceState } from '../../../repositories/workspace';

export function closeCommandPalette(): void {
    updateWorkspaceState({ commandPaletteOpen: false });
}