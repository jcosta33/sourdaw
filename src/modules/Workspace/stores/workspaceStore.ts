import { createStore } from '#/infra/store/createStore';
import { defaultWorkspaceState, type WorkspaceState } from '../useCases/workspaceQueries';

export const workspaceStore = createStore<WorkspaceState>({
    initialData: defaultWorkspaceState,
});
