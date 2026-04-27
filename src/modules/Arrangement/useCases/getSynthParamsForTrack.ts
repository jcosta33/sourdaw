import { getSynthParamsFromDevices } from '#/modules/Synth/useCases';

import { getTrackById } from './getTrackById';

const defaultTrackSynthParams = getSynthParamsFromDevices([]);

export function getSynthParamsForTrack(trackId: string): ReturnType<typeof getSynthParamsFromDevices> {
    const track = getTrackById(trackId);
    if (!track) {
        return { ...defaultTrackSynthParams };
    }
    return getSynthParamsFromDevices(track.devices);
}
