import { updateTrack } from '../../repositories/track/updateTrack';
import { trackStore } from '../../stores/trackStore';

export function unfreezeTrack(trackId: string): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    const track = state.tracks.find((t) => t.id === trackId);
    if (!track || track.freezeState.status === 'unfrozen') {
        return;
    }

    updateTrack(trackId, (t) => ({
        ...t,
        frozen: false,
        frozenBufferId: undefined,
        freezeState: { status: 'unfrozen' },
    }));
}
