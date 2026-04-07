import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';
import { DOC_PREFIX_ROOT } from '#/modules/CrdtDocument/useCases/crdtDocumentTypes';

import { type ArrangementData } from '../models/ProjectData';

export type ArrangementStoreState = {
    arrangements: ArrangementData[];
    activeArrangementId: string;
};

export const defaultArrangementId = 'default-arrangement';

export const arrangementStore = createStore<ArrangementStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'arrangements'),
    initialData: {
        arrangements: [
            {
                id: defaultArrangementId,
                name: 'Arrangement 1',
                tracks: { tracks: [], selectedTrackId: null },
                automation: { lanes: [] },
                midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
            },
        ],
        activeArrangementId: defaultArrangementId,
    },
});
