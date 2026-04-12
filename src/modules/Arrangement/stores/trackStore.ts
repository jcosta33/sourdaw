import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

export type {
    AutomationMode,
    Clip,
    Device,
    FollowAction,
    InputMonitoring,
    Send,
    StretchMode,
    Track,
    TrackAlternative,
    TrackKind,
} from '../models/Track';

import type { Track } from '../models/Track';

const DOC_PREFIX_ROOT = 'root';

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
