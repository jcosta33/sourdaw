import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { AutomergeStorage } from '#/helpers/Store/Storage/AutomergeStorage';
import { DOC_PREFIX_ROOT } from '#/modules/CrdtDocument/useCases/crdtDocumentTypes';

import { type TempoChange } from '../models/TempoMap';

const logger = Container.getInstance().get(Logger);

export type TempoMapStoreState = {
    changes: TempoChange[];
};

export const tempoMapStore = new Store<TempoMapStoreState>(logger, {
    storage: new AutomergeStorage(DOC_PREFIX_ROOT, 'tempoMap'),
    initialData: { changes: [] },
});
