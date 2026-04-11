import { getWorkspaceState, updateWorkspaceState } from '../../../repositories/workspace';

export function toggleCommandPalette(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ commandPaletteOpen: !current.commandPaletteOpen });
}