import { trackStore } from '#/modules/Arrangement/stores';
import { executeAppAction } from '#/modules/Command/useCases';

import { toGrandBouleDeviceState } from '../models/GrandBouleDeviceState';
import { createGrandBouleStore } from '../stores/grandBouleStore';

export function commitGrandBouleDeviceState(deviceId: string): void {
    const morph = createGrandBouleStore(deviceId).value?.morph;
    if (!morph) {
        return;
    }
    const next = toGrandBouleDeviceState(morph);
    const current = trackStore.value?.tracks
        .flatMap((track) => track.devices)
        .find((device) => device.id === deviceId)?.deviceState;
    if (JSON.stringify(current) === JSON.stringify(next)) {
        return;
    }
    void executeAppAction({ type: 'setDeviceState', payload: { deviceId, state: next } }, { skipMacroRecording: true });
}
