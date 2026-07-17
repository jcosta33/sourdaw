import { createTrack } from '#/modules/Arrangement/useCases';

import { buildDevice } from './buildDevice';

import type { Track } from '#/modules/Arrangement/stores';
import type { DeviceSpec } from './builderTypes';

type CreateBusInput = {
    name: string;
    devices: DeviceSpec[];
    color?: string;
    gain?: number;
};

export function createBus(input: CreateBusInput): Track {
    const bus = createTrack({ name: input.name, kind: 'bus' });
    bus.devices = input.devices.map(buildDevice);
    if (input.color !== undefined) {
        bus.color = input.color;
    }
    if (input.gain !== undefined) {
        bus.gain = input.gain;
    }
    return bus;
}
