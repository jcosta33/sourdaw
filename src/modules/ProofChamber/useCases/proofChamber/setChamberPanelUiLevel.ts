import { type Device, type Track, trackStore } from '#/modules/Arrangement/stores';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { captureProjectIdentity } from '#/modules/CrdtDocument/useCases';
import { canonicalJson } from '#/utils/canonicalDigest';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { effectDisclosureTierFromLevel } from '#/utils/UI/effectDisclosureTier';

const latestChoiceByDevice = new WeakMap<object, symbol>();

type ChamberDeviceTarget = { owner: Track; device: Device };

function resolveUniqueChamberDevice(deviceId: string): ChamberDeviceTarget | undefined {
    let target: ChamberDeviceTarget | undefined;
    for (const track of trackStore.value?.tracks ?? []) {
        for (const device of track.devices) {
            if (device.id !== deviceId) {
                continue;
            }
            // The project action addresses every device with this ID, regardless of type.
            if (target || device.type !== 'dutch-oven') {
                return undefined;
            }
            target = { owner: track, device };
        }
    }
    return target;
}

/**
 * Request one addressed device's disclosure choice in project truth. The panel
 * follows the project projection; this void action's resolution is not proof of
 * a write, so this function never changes the session state optimistically.
 */
export async function setChamberPanelUiLevel(deviceId: string, level: 1 | 2 | 3 | 4 | 5): Promise<void> {
    const target = resolveUniqueChamberDevice(deviceId);
    if (!target) {
        return;
    }
    const { owner, device } = target;
    const prior = device.deviceState;
    if (prior && prior.version !== 1) {
        notifyUser(
            'This Dutch Oven control layout was saved by a newer version and cannot be changed here.',
            'warning'
        );
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
                const currentTarget = resolveUniqueChamberDevice(deviceId);
                const currentDevice = currentTarget?.owner.id === owner.id ? currentTarget.device : undefined;
                if (
                    captureProjectIdentity() === projectIdentity &&
                    currentDevice === device &&
                    canonicalJson(currentDevice) === capturedDevice
                ) {
                    return true;
                }
                notifyUser(
                    'This Dutch Oven device changed before the control layout could be saved. Try again.',
                    'warning'
                );
                return false;
            },
        }
    );
}
