import { type WorkspaceState } from '../models/WorkspaceState';
import { workspaceStore } from '../stores/workspaceStore';

export function getWorkspaceState(): WorkspaceState | null {
    return workspaceStore.value;
}
