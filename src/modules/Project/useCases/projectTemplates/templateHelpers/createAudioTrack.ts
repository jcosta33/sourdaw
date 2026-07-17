import { createTrack } from '#/modules/Arrangement/useCases';

import { buildDevice } from './buildDevice';

import type { Track } from '#/modules/Arrangement/stores';
import type { DeviceSpec } from './builderTypes';

type CreateAudioTrackInput = {
    name: string;
    parentId?: string;
    devices?: DeviceSpec[];
    color?: string;
    gain?: number;
    pan?: number;
};

export function createAudioTrack(input: CreateAudioTrackInput): Track {
    const track = createTrack({ name: input.name, kind: 'audio', parentId: input.parentId });
    track.devices = (input.devices ?? []).map(buildDevice);
    if (input.color !== undefined) {
        track.color = input.color;
    }
    if (input.gain !== undefined) {
        track.gain = input.gain;
    }
    if (input.pan !== undefined) {
        track.pan = input.pan;
    }
    return track;
}
