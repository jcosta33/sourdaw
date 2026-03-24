/**
 * Ensures all track and bus strips exist in the audio engine
 * and syncs their gain/pan/mute/sends from the store state.
 *
 * Used by startPlayback and toggleRecording before audio begins.
 */

import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import {
    ensureTrackStrip,
    setTrackGain,
    setTrackPan,
    setTrackMute,
} from '#/modules/AudioEngine/useCases/trackAudioControls';
import { ensureBusStrip, setBusGain, setSend } from '#/modules/Routing/useCases/busControls';

export function ensureTrackStrips(): void {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return;
    }

    const busTracks = tracks.filter((t) => t.kind === 'bus');
    for (const bus of busTracks) {
        ensureBusStrip(bus.id);
        setBusGain(bus.id, bus.gain);
    }

    for (const track of tracks) {
        if (track.kind === 'folder') {
            continue;
        }
        ensureTrackStrip(track.id);
        setTrackGain(track.id, track.gain);
        setTrackPan(track.id, track.pan);
        setTrackMute(track.id, track.muted, track.gain);

        for (const send of track.sends) {
            setSend(track.id, send.busId, send.level, send.preFader);
        }
    }
}
