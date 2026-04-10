import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

const DOC_PREFIX_ROOT = 'root';

export type ProjectStoreState = {
    name: string;
    createdAt: number;
    updatedAt: number;
    dirty: boolean;
    loading: boolean;
    /** True once the user has explicitly started or loaded a project session.
     *  Ephemeral — not written to CRDT. Resets to false on every cold start.
     *  Controls whether the full-screen LaunchScreen is shown. */
    initialized: boolean;
};

export const projectStore = createStore<ProjectStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'projectMeta', {
        toCrdt: ({ name, createdAt, updatedAt }) => ({ name, createdAt, updatedAt }),
    }),
    initialData: {
        name: 'Untitled Project',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        dirty: false,
        loading: true,
        initialized: false,
    },
});
