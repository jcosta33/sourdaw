/**
 * useProjectState — local re-implementation using projectStore (contract).
 */
import { useSyncExternalStore } from 'react';
import { projectStore, type ProjectStoreState } from '#/modules/Project/stores/projectStore';

const defaultState: ProjectStoreState = {
    name: 'Untitled Project',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    dirty: false,
    loading: true,
};

export const useProjectState = (): ProjectStoreState => {
    return useSyncExternalStore(
        (onChange) => projectStore.subscribe(() => onChange()),
        () => projectStore.value ?? defaultState,
        () => projectStore.value ?? defaultState
    );
};
