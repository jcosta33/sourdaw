import { getTrackById } from './getTrackById';
import { defaultSynthParams, type SynthParams } from '#/modules/AudioEngine/useCases';
import { getSynthParamsFromDevices } from '#/modules/Synth/useCases';

export function getSynthParamsForTrack(trackId: string): SynthParams {
    const track = getTrackById(trackId);
    if (!track) {
        return { ...defaultSynthParams };
    }
    return getSynthParamsFromDevices(track.devices);
}
