import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';
import { DOC_PREFIX_ROOT } from '#/modules/CrdtDocument';

export type TempoChange = {
    id: string;
    beat: number;
    tempo: number;
    curve: 'instant' | 'linear';
};

export type TempoMapStoreState = {
    changes: TempoChange[];
};

export const tempoMapStore = createStore<TempoMapStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'tempoMap'),
    initialData: { changes: [] },
});
