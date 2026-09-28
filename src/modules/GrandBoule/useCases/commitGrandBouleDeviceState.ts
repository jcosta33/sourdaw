import { trackStore } from '#/modules/Arrangement/stores';
import { executeAppAction } from '#/modules/Command/useCases';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';

import {
    type GrandBoulePersistedState,
    readGrandBouleDeviceState,
    toGrandBouleDeviceState,
} from '../models/GrandBouleDeviceState';

import { reconcileGrandBouleDeviceStateFromProject } from './reconcileGrandBouleDeviceStateFromProject';

export function commitGrandBouleDeviceState(deviceId: string, state: GrandBoulePersistedState): void {
    const device = trackStore.value?.tracks
        .flatMap((track) => track.devices)
        .find((candidate) => candidate.id === deviceId && candidate.type === DEVICE_TYPE_IDS.grandBoule);
    if (!device) {
        return;
    }
    const before = toGrandBouleDeviceState(readGrandBouleDeviceState(device.deviceState));
    const after = toGrandBouleDeviceState(state);
    if (JSON.stringify(before) === JSON.stringify(after)) {
        reconcileGrandBouleDeviceStateFromProject(deviceId);
        return;
    }
    void executeAppAction({ type: 'setGrandBouleDeviceState', payload: { deviceId, before, after } }).catch(() =>
        reconcileGrandBouleDeviceStateFromProject(deviceId)
    );
}
