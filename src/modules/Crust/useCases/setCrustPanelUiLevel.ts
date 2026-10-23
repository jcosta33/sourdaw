import { trackStore } from '#/modules/Arrangement/stores';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { canonicalJson } from '#/utils/canonicalDigest';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { effectDisclosureTierFromLevel } from '#/utils/UI/effectDisclosureTier';

/**
 * Request one addressed device's disclosure choice in project truth. The panel
 * follows the project projection; this void action's resolution is not proof of
 * a write, so this function never changes the session patch optimistically.
 */
export async function setCrustPanelUiLevel(deviceId: string, level: 1 | 2 | 3 | 4 | 5): Promise<void> {
    const owner = trackStore.value?.tracks.find((track) =>
        track.devices.some((candidate) => candidate.id === deviceId && candidate.type === 'crust')
    );
    const device = owner?.devices.find((candidate) => candidate.id === deviceId && candidate.type === 'crust');
    if (!owner || !device) {
        return;
    }
    const prior = device.deviceState;
    if (prior && prior.version !== 1) {
        notifyUser('This Crust control layout was saved by a newer version and cannot be changed here.', 'warning');
        return;
    }
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
                const currentDevice = trackStore.value?.tracks
                    .find((track) => track.id === owner.id)
                    ?.devices.find((candidate) => candidate.id === deviceId && candidate.type === 'crust');
                if (currentDevice === device && canonicalJson(currentDevice) === capturedDevice) {
                    return true;
                }
                notifyUser('This Crust device changed before the control layout could be saved. Try again.', 'warning');
                return false;
            },
        }
    );
}
