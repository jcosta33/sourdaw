import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

const DOC_PREFIX_ROOT = 'root';

import { type Track } from '../models/Track';

export type TrackStoreState = {
    tracks: Track[];
    selectedTrackId: string | null;
};

export const defaultTrackState: TrackStoreState = {
    tracks: [],
    selectedTrackId: null,
};

export const trackStore = createStore<TrackStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'tracks', {
        toCrdt: ({ tracks }) => ({ tracks }),
    }),
    initialData: defaultTrackState,
});
