import { useStore } from '#/infra/store/useStore';

import { defaultWorkspaceState, type WorkspaceState } from '../../models/WorkspaceState';
import { workspaceStore } from '../../stores/workspaceStore';

export const useWorkspaceState = (): WorkspaceState => {
    return useStore(workspaceStore, defaultWorkspaceState);
};
