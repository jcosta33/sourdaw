import { getWorkspaceState as repoGetWorkspaceState } from '../../repositories/workspace';
import { type WorkspaceState } from '../../models/WorkspaceState';

export function getWorkspaceState(): WorkspaceState | null {
    return repoGetWorkspaceState();
}