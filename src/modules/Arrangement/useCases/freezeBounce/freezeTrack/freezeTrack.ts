import { trackStore } from '../../../stores/trackStore';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { renderTrackOffline } from '../renderOffline';

export async function freezeTrack(trackId: string): Promise<void> {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    const track = state.tracks.find((t) => t.id === trackId);
    if (!track || track.clips.length === 0) {
        trackStore.set({
            ...state,
            tracks: state.tracks.map((t) => {
                if (t.id !== trackId) {
                    return t;
                }
                return { ...t, frozen: true };
            }),
        });
        return;
    }

    const startBeat = Math.min(...track.clips.map((c) => c.startBeat));
    const endBeat = Math.max(...track.clips.map((c) => c.endBeat));

    const renderedBuffer = await renderTrackOffline(track, startBeat, endBeat);

    const frozenBufferId = renderedBuffer ? `frozen-${trackId}-${Date.now()}` : undefined;
    if (renderedBuffer && frozenBufferId) {
        audioBufferCache.set(frozenBufferId, renderedBuffer);
    }

    const freshState = trackStore.value;
    if (!freshState) {
        return;
    }

    trackStore.set({
        ...freshState,
        tracks: freshState.tracks.map((t) => {
            if (t.id !== trackId) {
                return t;
            }
            return {
                ...t,
                frozen: true,
                frozenBufferId,
                devices: t.devices.map((d) => ({ ...d, bypassed: true })),
            };
        }),
    });
}