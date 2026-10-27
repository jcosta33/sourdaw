import { trackStore } from '#/modules/Arrangement/stores';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { captureProjectIdentity } from '#/modules/CrdtDocument/useCases';
import { canonicalJson } from '#/utils/canonicalDigest';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { effectDisclosureTierFromLevel } from '#/utils/UI/effectDisclosureTier';

import type { Device } from '#/modules/Arrangement/stores';

const latestChoiceByDevice = new WeakMap<object, symbol>();

function resolveUniqueProofDevice(deviceId: string): { trackId: string; device: Device } | undefined {
    let target: { trackId: string; device: Device } | undefined;
    for (const track of trackStore.value?.tracks ?? []) {
        for (const device of track.devices) {
            if (device.id !== deviceId) {
                continue;
            }
            if (target) {
                return undefined;
            }
            target = { trackId: track.id, device };
        }
    }
    return target?.device.type === 'proof' ? target : undefined;
}

/**
 * Request one addressed device's disclosure choice in project truth. The panel
 * follows the project projection; this void action's resolution is not proof of
 * a write, so this function never changes the session state optimistically.
 */
export async function setProofPanelUiLevel(deviceId: string, level: 1 | 2 | 3 | 4 | 5): Promise<void> {
    const target = resolveUniqueProofDevice(deviceId);
    if (!target) {
        return;
    }
    const { device, trackId } = target;
    const prior = device.deviceState;
    if (prior && prior.version !== 1) {
        notifyUser('This Proof control layout was saved by a newer version and cannot be changed here.', 'warning');
        return;
    }
    const choice = Symbol();
    latestChoiceByDevice.set(device, choice);
    const projectIdentity = captureProjectIdentity();
    const capturedDevice = canonicalJson(device);
    await executeUserAppAction(
        {
            type: 'setDeviceState',
            payload: {
                deviceId,
                state: { version: 1, data: { ...prior?.data, disclosureTier: effectDisclosureTierFromLevel(level) } },
            },
        },
        {
            skipMacroRecording: true,
            shouldExecute: () => {
                if (latestChoiceByDevice.get(device) !== choice) {
                    return false;
                }
                const currentTarget = resolveUniqueProofDevice(deviceId);
                if (
                    captureProjectIdentity() === projectIdentity &&
                    currentTarget?.trackId === trackId &&
                    currentTarget.device === device &&
                    canonicalJson(currentTarget.device) === capturedDevice
                ) {
                    return true;
                }
                notifyUser('This Proof device changed before the control layout could be saved. Try again.', 'warning');
                return false;
            },
        }
    );
}
