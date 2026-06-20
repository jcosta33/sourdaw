import { createStore } from '#/infra/store/createStore';

import { defaultWorkspaceState, type WorkspaceState } from '../models/WorkspaceState';

// Re-export the canonical default so existing `stores`-barrel consumers keep resolving.
// The single source of truth lives in models/WorkspaceState.ts — do not redeclare it here.
export { defaultWorkspaceState };

export const workspaceStore = createStore<WorkspaceState>({
    initialData: defaultWorkspaceState,
});
