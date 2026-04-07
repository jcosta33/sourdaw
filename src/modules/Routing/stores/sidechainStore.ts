import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';
import { DOC_PREFIX_ROOT } from '#/modules/CrdtDocument/useCases/crdtDocumentTypes';

import { type SidechainRoute } from '#/modules/AudioEngine/models/SidechainRoute';

export type SidechainStoreState = {
    routes: SidechainRoute[];
};

export const sidechainStore = createStore<SidechainStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'sidechainRoutes'),
    initialData: { routes: [] },
});
