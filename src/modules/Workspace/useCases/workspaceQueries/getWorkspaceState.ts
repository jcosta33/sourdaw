import { type WorkspaceState } from '../../models/WorkspaceState';
import { getWorkspaceState as repoGetWorkspaceState } from '../../repositories/getWorkspaceState';

export function getWorkspaceState(): WorkspaceState | null {
    return repoGetWorkspaceState();
}
