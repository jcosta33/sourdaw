import { buildDevice } from './buildDevice';

import type { Track } from '#/modules/Arrangement/stores';
import type { DeviceSpec } from './builderTypes';

export function addDeviceChain(track: Track, devices: DeviceSpec[]): void {
    const additions = devices.map(buildDevice);
    track.devices = [...track.devices, ...additions];
}
