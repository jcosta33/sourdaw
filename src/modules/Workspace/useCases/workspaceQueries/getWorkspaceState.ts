import { type WorkspaceState } from '../../models/WorkspaceState';
import { getWorkspaceState as repoGetWorkspaceState } from '../../repositories/workspace';

export function getWorkspaceState(): WorkspaceState | null {
    return repoGetWorkspaceState();
}
