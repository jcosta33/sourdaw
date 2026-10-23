import { trackStore } from '#/modules/Arrangement/stores';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { effectDisclosureTierFromLevel } from '#/utils/UI/effectDisclosureTier';

/**
 * Request one addressed device's disclosure choice in project truth. The panel
 * follows the project projection; this void action's resolution is not proof of
 * a write, so this function never changes the session patch optimistically.
 */
export async function setCrustPanelUiLevel(deviceId: string, level: 1 | 2 | 3 | 4 | 5): Promise<void> {
    const device = trackStore.value?.tracks
        .flatMap((track) => track.devices)
        .find((candidate) => candidate.id === deviceId && candidate.type === 'crust');
    if (!device) {
        return;
    }
    const prior = device.deviceState;
    if (prior && prior.version !== 1) {
        notifyUser('This Crust control layout was saved by a newer version and cannot be changed here.', 'warning');
        return;
    }
    await executeUserAppAction(
        {
            type: 'setDeviceState',
            payload: {
                deviceId,
                state: { version: 1, data: { ...prior?.data, disclosureTier: effectDisclosureTierFromLevel(level) } },
            },
        },
        { skipMacroRecording: true }
    );
}
