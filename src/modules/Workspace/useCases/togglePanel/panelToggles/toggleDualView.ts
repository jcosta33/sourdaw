import { updateWorkspaceState } from '../../workspaceState';
import { workspaceStore } from '../../../stores/workspaceStore';

/**
 * Toggle between single view and Session+Arrangement side-by-side view (D1).
 */
export function toggleDualView(force?: boolean): void {
    const current = workspaceStore.value?.dualViewOpen ?? false;
    updateWorkspaceState({ dualViewOpen: force !== undefined ? force : !current });
}
