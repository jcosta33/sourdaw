import { Store } from '#/helpers/Store/Store';
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { AutomergeStorage } from '#/helpers/Store/Storage/AutomergeStorage';
// DOC_PREFIX_ROOT inlined from CrdtDocument — promote CrdtDocumentTypes to public surface in final convergence
const DOC_PREFIX_ROOT = 'root';

import { type ArrangementData } from '../models/ProjectData';

export type ArrangementStoreState = {
    arrangements: ArrangementData[];
    activeArrangementId: string;
};

export const defaultArrangementId = 'default-arrangement';

const logger = Container.getInstance().get(Logger);

export const arrangementStore = new Store<ArrangementStoreState>(logger, {
    storage: new AutomergeStorage(DOC_PREFIX_ROOT, 'arrangements'),
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
