import { type resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { type DeviceRef } from '#/utils/createFindDeviceRef';

import { type GrinderPatch } from '../../models/GrinderPatch';

import { encodeGrinderPatchCommands } from './encodeGrinderPatchCommands';
import { paramBatcher } from './helpers';

type SyncGrinderPatchToAudioInput = {
    patch: GrinderPatch;
    ref: DeviceRef;
    persist_device_param: (device_id: string, key: string, value: number) => void;
    update_device_param: (track_id: string, device_id: string, key: string, value: number) => void;
    update_device_patch: (track_id: string, device_id: string, patch: Record<string, unknown>) => void;
    resolve_eligible_device_write_target: typeof resolveEligibleDeviceWriteTarget;
};

function sendNumericParamToDevice(
    input: Pick<SyncGrinderPatchToAudioInput, 'persist_device_param' | 'ref' | 'update_device_param'>,
    key: string,
    value: number
): void {
    // A patch load or snapshot recall is a wholesale write: drop this device's
    // queued drag frame for the key so it cannot fire after the push and
    // overwrite the loaded value. Per-key cancel keeps drags pending on other
    // devices and other keys still flushing.
    paramBatcher.cancel(`${input.ref.deviceId}:${key}`);
    input.update_device_param(input.ref.trackId, input.ref.deviceId, key, value);
    input.persist_device_param(input.ref.deviceId, key, value);
}

export function syncGrinderPatchToAudio(input: SyncGrinderPatchToAudioInput): void {
    const target = input.resolve_eligible_device_write_target(input.ref.deviceId);
    if (target.status !== 'eligible' || target.trackId !== input.ref.trackId) {
        return;
    }

    for (const command of encodeGrinderPatchCommands(input.patch)) {
        if (command.kind === 'parameter') {
            sendNumericParamToDevice(input, command.key, command.value);
        } else {
            input.update_device_patch(input.ref.trackId, input.ref.deviceId, command.patch);
        }
    }
}
