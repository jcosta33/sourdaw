import { createHandler } from '#/utils/createHandler';

import { removeDevice } from '../../useCases/device/removeDevice';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';

export const handleRemoveDevice = createHandler<'removeDevice'>({
    execute: (alpha) => {
        if (alpha.payload.expectedTrackId || alpha.payload.expectedDeviceIds) {
            const owners = (getTrackStoreState()?.tracks ?? []).filter((track) =>
                track.devices.some((device) => device.id === alpha.payload.deviceId)
            );
            const owner = owners.length === 1 ? owners[0] : undefined;
            const currentDeviceIds = owner?.devices.map((device) => device.id);
            if (
                !owner ||
                owner.id !== alpha.payload.expectedTrackId ||
                !alpha.payload.expectedDeviceIds ||
                alpha.payload.expectedDeviceIds.length !== currentDeviceIds?.length ||
                alpha.payload.expectedDeviceIds.some((deviceId, index) => currentDeviceIds[index] !== deviceId)
            ) {
                return { status: 'conflict' };
            }
        }
        const result = removeDevice(alpha.payload.deviceId, { deferRuntimeEffects: true });
        if (result === 'conflict') {
            return { status: 'conflict' };
        }
        if (result === 'missing') {
            return { status: 'no-write' };
        }
        if (result === 'written') {
            return { status: 'written' };
        }
        return {
            status: result.outcome,
            afterCommit: result.afterCommit,
            afterAmbiguousCommit: result.afterAmbiguousCommit,
        };
    },
    describe: (action) => {
        const state = getTrackStoreState();
        const owners = (state?.tracks ?? []).flatMap((track) => {
            const deviceIndex = track.devices.findIndex((device) => device.id === action.payload.deviceId);
            if (deviceIndex < 0) {
                return [];
            }
            return [{ track, deviceIndex, device: track.devices[deviceIndex]! }];
        });
        const target = owners.length === 1 ? owners[0] : undefined;
        if (!target) {
            return { label: 'Remove device', inverseAction: null };
        }
        return {
            label: `Remove ${target.device.name}`,
            inverseAction: {
                type: 'restoreDevice',
                payload: {
                    trackId: target.track.id,
                    deviceSnapshot: structuredClone(target.device),
                    deviceIndex: target.deviceIndex,
                    expectedDeviceIds: target.track.devices
                        .filter((device) => device.id !== action.payload.deviceId)
                        .map((device) => device.id),
                },
            },
        };
    },
    requiresAbortCompensation: false,
    undoable: true,
});
