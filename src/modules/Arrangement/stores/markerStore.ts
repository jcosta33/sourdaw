import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

const DOC_PREFIX_ROOT = 'root';

export type Marker = {
    id: string;
    beat: number;
    name: string;
    color: string;
};

export type ArrangementSection = {
    id: string;
    startBeat: number;
    endBeat: number;
    name: string;
    color: string;
};

export type MarkerStoreState = {
    markers: Marker[];
    sections: ArrangementSection[];
};

export const defaultMarkerStoreState: MarkerStoreState = { markers: [], sections: [] };

export const markerStore = createStore<MarkerStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'markers'),
    initialData: defaultMarkerStoreState,
});
