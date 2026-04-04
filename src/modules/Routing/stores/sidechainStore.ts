import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { AutomergeStorage } from '#/helpers/Store/Storage/AutomergeStorage';
// DOC_PREFIX_ROOT inlined from CrdtDocument — promote CrdtDocumentTypes to public surface in final convergence
const DOC_PREFIX_ROOT = 'root';

import { type SidechainRoute } from '#/modules/AudioEngine/models/SidechainRoute';

const logger = Container.getInstance().get(Logger);

export type SidechainStoreState = {
    routes: SidechainRoute[];
};

export const sidechainStore = new Store<SidechainStoreState>(logger, {
    storage: new AutomergeStorage(DOC_PREFIX_ROOT, 'sidechainRoutes'),
    initialData: { routes: [] },
});
