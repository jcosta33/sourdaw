import { trackStore } from '#/modules/Arrangement/stores';
import { jsonValuesEqual } from '#/utils/jsonSemanticEquality';

import { type ToasterKit } from '../models/ToasterKit';
import { toToasterKitState } from '../models/ToasterKitState';

/**
 * Whether the document already holds exactly the chunk this kit would write for
 * the device. Writing it would only dirty the project it was read from.
 */
export function isToasterKitDocumented(deviceId: string, kit: ToasterKit): boolean {
    const device = trackStore.value?.tracks
        .flatMap((track) => track.devices)
        .find((candidate) => candidate.id === deviceId);
    return device?.deviceState !== undefined && jsonValuesEqual(device.deviceState, toToasterKitState(kit));
}
