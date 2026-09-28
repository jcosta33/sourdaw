import { trackStore } from '#/modules/Arrangement/stores';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';

import { readGrandBouleDeviceState } from '../models/GrandBouleDeviceState';
import { type GrandBouleMorphState } from '../models/GrandBouleMorphState';
import { createGrandBouleStore } from '../stores/grandBouleStore';

export function hydrateGrandBouleMorphStateFromProject(deviceId: string): GrandBouleMorphState | null {
    const device = trackStore.value?.tracks
        .flatMap((track) => track.devices)
        .find((candidate) => candidate.id === deviceId && candidate.type === DEVICE_TYPE_IDS.grandBoule);
    if (!device) {
        return null;
    }
    const persisted = readGrandBouleDeviceState(device.deviceState);
    const store = createGrandBouleStore(deviceId);
    const state = store.value;
    if (
        state &&
        (JSON.stringify(state.morph) !== JSON.stringify(persisted.morph) ||
            state.temperament !== persisted.temperament ||
            JSON.stringify(state.parameters) !== JSON.stringify(persisted.parameters))
    ) {
        store.set({
            ...state,
            morph: persisted.morph,
            temperament: persisted.temperament,
            parameters: persisted.parameters,
        });
    }
    return persisted.morph;
}
