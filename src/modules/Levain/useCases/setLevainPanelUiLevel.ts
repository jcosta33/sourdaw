import { trackStore } from '#/modules/Arrangement/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { toLevainDeviceState } from '../models/LevainDeviceState';
import { levainStore } from '../stores/levainStore';

import { coordinateLevainDeviceState } from './coordinateLevainDeviceState';

/** Request project truth; only its authoritative projection may paint the choice. */
export async function setLevainPanelUiLevel(deviceId: string, level: 1 | 6): Promise<void> {
    const device = trackStore.value?.tracks
        .flatMap((track) => track.devices)
        .find((candidate) => candidate.id === deviceId && candidate.type === 'levain');
    const state = levainStore.value?.[deviceId];
    if (!device || !state) {
        return;
    }
    if (device.deviceState && device.deviceState.version !== 1) {
        notifyUser('This Levain control layout was saved by a newer version and cannot be changed here.', 'warning');
        return;
    }
    await coordinateLevainDeviceState(
        deviceId,
        'tier',
        (prior) => ({
            version: 1,
            data: {
                ...toLevainDeviceState(state.patch).data,
                ...prior?.data,
                disclosureTier: level === 6 ? 'expert' : 'basic',
            },
        }),
        () => {
            notifyUser('This Levain device changed before the control layout could be saved. Try again.', 'warning');
        }
    );
}
