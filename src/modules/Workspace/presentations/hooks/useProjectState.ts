/**
 * useProjectState — local re-implementation using projectStore (contract).
 */
import { useStore } from '#/infra/store/useStore';
import { projectStore, type ProjectStoreState } from '#/modules/Project';

const defaultState: ProjectStoreState = {
    name: 'Untitled Project',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    dirty: false,
    loading: true,
    initialized: false,
};

export const useProjectState = (): ProjectStoreState => {
    return useStore(projectStore, defaultState);
};
