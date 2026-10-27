import { trackStore } from '#/modules/Arrangement/stores';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { captureProjectIdentity } from '#/modules/CrdtDocument/useCases';
import { canonicalJson } from '#/utils/canonicalDigest';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { effectDisclosureTierFromLevel } from '#/utils/UI/effectDisclosureTier';

import type { Device } from '#/modules/Arrangement/stores';

const latestChoiceByDevice = new WeakMap<object, symbol>();

type GlutenDeviceTarget = { trackId: string; device: Device };

// The shared state action addresses every matching id, including devices of other types.
function resolveUniqueGlutenDevice(deviceId: string): GlutenDeviceTarget | undefined {
    let target: GlutenDeviceTarget | undefined;
    for (const track of trackStore.value?.tracks ?? []) {
        for (const device of track.devices) {
            if (device.id !== deviceId) {
                continue;
            }
            if (target || device.type !== 'gluten') {
                return;
            }
            target = { trackId: track.id, device };
        }
    }
    return target;
}

/**
 * Request one addressed device's disclosure choice in project truth. The panel
 * follows the project projection; this void action's resolution is not proof of
 * a write, so this function never changes the session state optimistically.
 */
export async function setGlutenPanelUiLevel(deviceId: string, level: 1 | 2 | 3 | 4 | 5): Promise<void> {
    const target = resolveUniqueGlutenDevice(deviceId);
    if (!target) {
        return;
    }
    const { device } = target;
    const prior = device.deviceState;
    if (prior && prior.version !== 1) {
        notifyUser('This Gluten control layout was saved by a newer version and cannot be changed here.', 'warning');
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
                const currentTarget = resolveUniqueGlutenDevice(deviceId);
                if (
                    captureProjectIdentity() === projectIdentity &&
                    currentTarget?.trackId === target.trackId &&
                    currentTarget.device === device &&
                    canonicalJson(currentTarget.device) === capturedDevice
                ) {
                    return true;
                }
                notifyUser(
                    'This Gluten device changed before the control layout could be saved. Try again.',
                    'warning'
                );
                return false;
            },
        }
    );
}
