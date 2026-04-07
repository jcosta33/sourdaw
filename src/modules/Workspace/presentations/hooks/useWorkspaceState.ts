import { useStore } from '#/infra/store/useStore';
import { workspaceStore } from '../../stores/workspaceStore';
import { defaultWorkspaceState, type WorkspaceState } from '../../models/WorkspaceState';

export const useWorkspaceState = (): WorkspaceState => {
    return useStore(workspaceStore, defaultWorkspaceState);
};
