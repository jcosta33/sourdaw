import { builtinSynthVoice } from '#/modules/AudioEngine/useCases';

import { getTrackById } from './getTrackById';

type TrackSynthParams = ReturnType<ReturnType<typeof builtinSynthVoice.read>['getSynthParamsFromDevices']>;

export function getSynthParamsForTrack(trackId: string): TrackSynthParams {
    const { getSynthParamsFromDevices } = builtinSynthVoice.read('getSynthParamsForTrack');
    const track = getTrackById(trackId);
    return getSynthParamsFromDevices(track?.devices ?? []);
}
