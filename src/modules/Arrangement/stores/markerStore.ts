import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

const DOC_PREFIX_ROOT = 'root';

import { type Marker, type ArrangementSection } from '../models/Marker';

export type MarkerStoreState = {
    markers: Marker[];
    sections: ArrangementSection[];
};

export const markerStore = createStore<MarkerStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'markers'),
    initialData: { markers: [], sections: [] },
});
