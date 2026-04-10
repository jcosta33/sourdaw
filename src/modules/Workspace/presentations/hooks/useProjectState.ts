/**
 * useProjectState — local re-implementation using projectStore (contract).
 */
import { useStore } from '#/infra/store/useStore';
import { projectStore } from '#/modules/Project';

type ProjectViewState = {
    name: string;
    createdAt: number;
    updatedAt: number;
    dirty: boolean;
    loading: boolean;
    initialized: boolean;
};

const defaultState: ProjectViewState = {
    name: 'Untitled Project',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    dirty: false,
    loading: true,
    initialized: false,
};

export const useProjectState = (): ProjectViewState => {
    return useStore(projectStore, defaultState);
};
