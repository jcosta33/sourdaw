/**
 * useProjectLoadFailure — subscribe to the terminal project-open failure.
 *
 * Non-null only when an open replaced the CRDT authority and then failed, so
 * there is no previous session to go back to and no project open.
 */
import { useStore } from '#/infra/store/useStore';
import { projectLoadFailureStore } from '#/modules/Project/stores';

import type { ProjectLoadFailureState } from '#/modules/Project/stores';

export const useProjectLoadFailure = (): ProjectLoadFailureState | null => {
    return useStore(projectLoadFailureStore, null);
};
