import { useSyncExternalStore } from 'react';
import { projectStore, type ProjectStoreState } from '../../stores/projectStore';

const defaultState: ProjectStoreState = {
    name: 'Untitled Project',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    dirty: false,
};

export const useProjectState = (): ProjectStoreState => {
    return useSyncExternalStore(
        (onChange) => projectStore.subscribe(() => onChange()),
        () => projectStore.value ?? defaultState,
        () => projectStore.value ?? defaultState
    );
};
