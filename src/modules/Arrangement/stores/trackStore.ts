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

import type { Track, Clip } from '../models/Track';

const DOC_PREFIX_ROOT = 'root';

export type TrackStoreState = {
    tracks: Track[];
    selectedTrackId: string | null;
    /** E1: Ephemeral AI-suggested clips not yet part of the tracks. */
    ghostClips?: (Clip & { trackId: string })[];
};

export const defaultTrackState: TrackStoreState = {
    tracks: [],
    selectedTrackId: null,
    ghostClips: [],
};

export const trackStore = createStore<TrackStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'tracks', {
        toCrdt: ({ tracks }) => ({ tracks }),
    }),
    initialData: defaultTrackState,
});
