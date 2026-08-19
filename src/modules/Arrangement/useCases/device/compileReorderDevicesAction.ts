import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { getTrackEligibility } from '../../stores/trackEligibility';
import { getTrackStoreState } from '../getTrackStoreState';
import { runtimeGraphTopology } from '../runtimeGraphTopology';

type ReorderDevicesAction = Extract<AppAction, { type: 'reorderDevices' }>;

function hasUniqueDeviceIds(deviceIds: readonly string[]): boolean {
    return new Set(deviceIds).size === deviceIds.length;
}

/**
 * Turns a rack drag's device identities into an application-owned, revision-bound
 * project command. Presentation never supplies a target order or topology proof.
 */
export function compileReorderDevicesAction(
    trackId: string,
    deviceId: string,
    targetDeviceId: string
): ReorderDevicesAction | null {
    const owners = (getTrackStoreState()?.tracks ?? []).filter((track) => track.id === trackId);
    const track = owners.length === 1 ? owners[0] : undefined;
    if (
        !track ||
        !getTrackEligibility(track.kind).acceptsDeviceUpdate ||
        !hasUniqueDeviceIds(track.devices.map((device) => device.id)) ||
        deviceId === targetDeviceId
    ) {
        return null;
    }

    const sourceIndices = track.devices.flatMap((device, index) => (device.id === deviceId ? [index] : []));
    const targetIndices = track.devices.flatMap((device, index) => (device.id === targetDeviceId ? [index] : []));
    if (sourceIndices.length !== 1 || targetIndices.length !== 1) {
        return null;
    }

    return {
        type: 'reorderDevices',
        payload: {
            trackId,
            deviceId,
            targetIndex: targetIndices[0]!,
            expectedBefore: runtimeGraphTopology.createNode(track),
            expectedProjectRevision: captureProjectRevision(),
        },
    };
}
