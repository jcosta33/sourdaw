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
import { addDeviceToStrip, updateDeviceParam } from '#/modules/AudioEngine/useCases/deviceControls';
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

        // Bootstrap devices (effects & instruments) from the store data.
        // Without this, devices exist in the UI but have no audio nodes.
        for (const device of track.devices) {
            addDeviceToStrip(track.id, device.id, device.type);
            // Apply stored parameter values to the newly created audio nodes
            if (device.parameterValues) {
                for (const [paramId, value] of Object.entries(device.parameterValues)) {
                    if (typeof value === 'number') {
                        updateDeviceParam(track.id, device.id, paramId, value);
                    }
                }
            }
        }

        for (const send of track.sends) {
            setSend(track.id, send.busId, send.level, send.preFader);
        }
    }
}
