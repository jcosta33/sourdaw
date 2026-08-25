import { trackStore } from '#/modules/Arrangement/stores';
import { executeAppAction } from '#/modules/Command/useCases';

import { readGrandBouleMorphState, toGrandBouleDeviceState } from '../models/GrandBouleDeviceState';
import { type GrandBouleMorphState } from '../models/GrandBouleMorphState';

import { reconcileGrandBouleDeviceStateFromProject } from './reconcileGrandBouleDeviceStateFromProject';

export function commitGrandBouleDeviceState(deviceId: string, morph: GrandBouleMorphState): void {
    const device = trackStore.value?.tracks
        .flatMap((track) => track.devices)
        .find((candidate) => candidate.id === deviceId && candidate.type === 'grand-boule');
    if (!device) {
        return;
    }
    const before = toGrandBouleDeviceState(readGrandBouleMorphState(device.deviceState));
    const after = toGrandBouleDeviceState(morph);
    if (JSON.stringify(before) === JSON.stringify(after)) {
        reconcileGrandBouleDeviceStateFromProject(deviceId);
        return;
    }
    void executeAppAction({ type: 'setGrandBouleDeviceState', payload: { deviceId, before, after } }).catch(() =>
        reconcileGrandBouleDeviceStateFromProject(deviceId)
    );
}
