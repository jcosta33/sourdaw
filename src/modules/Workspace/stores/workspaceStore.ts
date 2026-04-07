import { createStore } from '#/infra/store/createStore';
import { defaultWorkspaceState, type WorkspaceState } from '../models/WorkspaceState';

export const workspaceStore = createStore<WorkspaceState>({
    initialData: defaultWorkspaceState,
});
