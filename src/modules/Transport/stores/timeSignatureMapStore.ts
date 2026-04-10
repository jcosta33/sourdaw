import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';
import { DOC_PREFIX_ROOT } from '#/modules/CrdtDocument';

export type TimeSignatureChange = {
    id: string;
    beat: number;
    numerator: number;
    denominator: number;
};

export type TimeSignatureMapStoreState = {
    changes: TimeSignatureChange[];
};

export const timeSignatureMapStore = createStore<TimeSignatureMapStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'timeSignatureMap'),
    initialData: { changes: [] },
});
