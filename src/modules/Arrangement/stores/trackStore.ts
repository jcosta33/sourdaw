import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { AutomergeStorage } from '#/helpers/Store/Storage/AutomergeStorage';
import { DOC_PREFIX_ROOT } from '#/modules/CrdtDocument/models/CrdtDocumentTypes';

import { type Track } from '../models/Track';

const logger = Container.getInstance().get(Logger);

export type TrackStoreState = {
    tracks: Track[];
    selectedTrackId: string | null;
};

export const trackStore = new Store<TrackStoreState>(logger, {
    storage: new AutomergeStorage(DOC_PREFIX_ROOT, 'tracks', {
        toCrdt: ({ tracks }) => ({ tracks }),
    }),
    initialData: {
        tracks: [],
        selectedTrackId: null,
    },
});
