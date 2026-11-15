import { trackStore } from '#/modules/Arrangement/stores';
import { jsonValuesEqual } from '#/utils/jsonSemanticEquality';

import { toCrumbsDeviceState } from '../models/CrumbsDeviceState';
import { type CrumbsState } from '../stores/crumbsStore';

/**
 * Whether the document already holds exactly the chunk this session state would
 * write for the device. Writing it would only dirty the project it was read from.
 */
export function isCrumbsDeviceStateDocumented(deviceId: string, state: CrumbsState): boolean {
    const device = trackStore.value?.tracks
        .flatMap((track) => track.devices)
        .find((candidate) => candidate.id === deviceId);
    return (
        device?.deviceState !== undefined &&
        jsonValuesEqual(device.deviceState, toCrumbsDeviceState({ mode: state.mode, activeSample: state.activeSample }))
    );
}
