import { getWorkspaceState } from '../repositories/getWorkspaceState';
import { updateWorkspaceState } from '../repositories/updateWorkspaceState';

import { type WorkspaceMode } from './workspaceQueries/helpers';

export function setWorkspaceMode(mode: WorkspaceMode): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ mode });
}
