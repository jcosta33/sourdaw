import { createTrack } from '#/modules/Arrangement/useCases';

import { buildDevice } from './buildDevice';

import type { Track } from '#/modules/Arrangement/stores';
import type { DeviceSpec } from './buildDevice';

type CreateInstrumentTrackInput = {
    name: string;
    parentId?: string;
    deviceType: string;
    deviceName?: string;
    deviceParams?: Record<string, number>;
    extraDevices?: DeviceSpec[];
    color?: string;
    gain?: number;
    pan?: number;
};

export function createInstrumentTrack(input: CreateInstrumentTrackInput): Track {
    const track = createTrack({ name: input.name, kind: 'midi', parentId: input.parentId });
    const instrument = buildDevice({
        type: input.deviceType,
        name: input.deviceName ?? input.name,
        params: input.deviceParams,
    });
    const extras = (input.extraDevices ?? []).map(buildDevice);
    track.devices = [instrument, ...extras];
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
