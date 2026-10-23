import { trackStore } from '#/modules/Arrangement/stores';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { canonicalJson } from '#/utils/canonicalDigest';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { toLevainDeviceState } from '../models/LevainDeviceState';
import { levainStore } from '../stores/levainStore';

/** Request project truth; only its authoritative projection may paint the choice. */
export async function setLevainPanelUiLevel(deviceId: string, level: 1 | 6): Promise<void> {
    const owner = trackStore.value?.tracks.find((track) =>
        track.devices.some((candidate) => candidate.id === deviceId && candidate.type === 'levain')
    );
    const device = owner?.devices.find((candidate) => candidate.id === deviceId && candidate.type === 'levain');
    const state = levainStore.value?.[deviceId];
    if (!owner || !device || !state) {
        return;
    }
    const prior = device.deviceState;
    if (prior && prior.version !== 1) {
        notifyUser('This Levain control layout was saved by a newer version and cannot be changed here.', 'warning');
        return;
    }
    const capturedDevice = canonicalJson(device);
    await executeUserAppAction(
        {
            type: 'setDeviceState',
            payload: {
                deviceId,
                state: {
                    version: 1,
                    data: {
                        ...toLevainDeviceState(state.patch).data,
                        ...prior?.data,
                        disclosureTier: level === 6 ? 'expert' : 'basic',
                    },
                },
            },
        },
        {
            skipMacroRecording: true,
            shouldExecute: () => {
                const current = trackStore.value?.tracks
                    .find((track) => track.id === owner.id)
                    ?.devices.find((candidate) => candidate.id === deviceId && candidate.type === 'levain');
                if (current === device && canonicalJson(current) === capturedDevice) {
                    return true;
                }
                notifyUser(
                    'This Levain device changed before the control layout could be saved. Try again.',
                    'warning'
                );
                return false;
            },
        }
    );
}
