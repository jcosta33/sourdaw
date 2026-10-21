import { trackStore } from '#/modules/Arrangement/stores';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { toLevainDeviceState } from '../models/LevainDeviceState';
import { levainStore } from '../stores/levainStore';

/** Request project truth; only its authoritative projection may paint the choice. */
export async function setLevainPanelUiLevel(deviceId: string, level: 1 | 6): Promise<void> {
    const device = trackStore.value?.tracks
        .flatMap((track) => track.devices)
        .find((candidate) => candidate.id === deviceId && candidate.type === 'levain');
    const state = levainStore.value?.[deviceId];
    if (!device || !state) {
        return;
    }
    const prior = device.deviceState;
    if (prior && prior.version !== 1) {
        notifyUser('This Levain control layout was saved by a newer version and cannot be changed here.', 'warning');
        return;
    }
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
        { skipMacroRecording: true }
    );
}
