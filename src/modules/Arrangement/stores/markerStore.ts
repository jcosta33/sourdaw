import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { AutomergeStorage } from '#/helpers/Store/Storage/AutomergeStorage';
import { DOC_PREFIX_ROOT } from '#/modules/CrdtDocument/models/CrdtDocumentTypes';

import { type Marker, type ArrangementSection } from '../models/Marker';

const logger = Container.getInstance().get(Logger);

export type MarkerStoreState = {
    markers: Marker[];
    sections: ArrangementSection[];
};

export const markerStore = new Store<MarkerStoreState>(logger, {
    storage: new AutomergeStorage(DOC_PREFIX_ROOT, 'markers'),
    initialData: { markers: [], sections: [] },
});
