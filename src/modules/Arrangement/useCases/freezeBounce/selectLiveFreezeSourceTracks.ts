import { type Track, trackStore } from '../../stores/trackStore';

import { selectFreezeSourceTracks } from './freezeSourceTracks';

/** The freeze sources of `trackId` in the live track list; empty when the track is gone. */
export function selectLiveFreezeSourceTracks(trackId: string): Track[] {
    return selectFreezeSourceTracks(trackId, trackStore.value?.tracks ?? []);
}
