import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';
import { DOC_PREFIX_ROOT } from '#/modules/CrdtDocument';
import { type SidechainRoute } from '../models/SidechainRoute';

export type SidechainStoreState = {
    routes: SidechainRoute[];
};

export const sidechainStore = createStore<SidechainStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'sidechainRoutes'),
    initialData: { routes: [] },
});
