import { trackStore } from '../../../stores/trackStore';
import { audioBufferCache } from '#/modules/AudioEngine/stores';

export function unfreezeTrack(trackId: string): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    const track = state.tracks.find((t) => t.id === trackId);
    if (track?.frozenBufferId) {
        audioBufferCache.remove(track.frozenBufferId);
    }

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => {
            if (t.id !== trackId) {
                return t;
            }
            return {
                ...t,
                frozen: false,
                frozenBufferId: undefined,
                devices: t.devices.map((d) => ({ ...d, bypassed: false })),
            };
        }),
    });
}