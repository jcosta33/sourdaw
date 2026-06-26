import { createStore } from '#/infra/store/createStore';

import { type EditingTool } from '../models/EditingTool';
import { defaultWorkspaceState, type WorkspaceState } from '../models/WorkspaceState';

// Re-export the canonical default so existing `stores`-barrel consumers keep resolving.
// The single source of truth lives in models/WorkspaceState.ts — do not redeclare it here.
export { defaultWorkspaceState };

// Re-export the public state types alongside the store that holds them. The
// `useCases/` contract barrel must not re-export types (arch rule
// `no-usecase-type-exports-on-index`), so the cross-module type surface lives on
// the `stores/` barrel next to `workspaceStore`/`defaultWorkspaceState`.
export type { WorkspaceState, EditingTool };

export const workspaceStore = createStore<WorkspaceState>({
    initialData: defaultWorkspaceState,
});
