import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { AutomergeStorage } from '#/helpers/Store/Storage/AutomergeStorage';
import { DOC_PREFIX_ROOT } from '#/modules/CrdtDocument/models/CrdtDocumentTypes';

const logger = Container.getInstance().get(Logger);

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

export const projectStore = new Store<ProjectStoreState>(logger, {
    storage: new AutomergeStorage(DOC_PREFIX_ROOT, 'projectMeta', {
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
