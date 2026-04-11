import { getWorkspaceState, updateWorkspaceState } from '../../../repositories/workspace';

export function toggleWorkspaceMode(): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ mode: current.mode === 'arrange' ? 'clip' : 'arrange' });
}