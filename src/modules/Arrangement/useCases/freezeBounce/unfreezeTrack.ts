import { updateTrack } from '../../repositories/track/updateTrack';
import { trackStore } from '../../stores/trackStore';

import { cancelFreezeTrack } from './cancelFreezeTrack';

export function unfreezeTrack(trackId: string): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    const track = state.tracks.find((time) => time.id === trackId);
    if (!track || track.freezeState.status === 'unfrozen') {
        return;
    }

    // A freeze still rendering would otherwise pass its current-task check and commit over this write.
    cancelFreezeTrack(trackId);
    updateTrack(trackId, (time) => ({
        ...time,
        frozen: false,
        frozenBufferId: undefined,
        freezeState: { status: 'unfrozen' },
    }));
}
