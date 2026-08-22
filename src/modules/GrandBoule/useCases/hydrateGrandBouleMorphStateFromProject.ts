import { trackStore } from '#/modules/Arrangement/stores';

import { readGrandBouleMorphState } from '../models/GrandBouleDeviceState';
import { type GrandBouleMorphState } from '../models/GrandBouleMorphState';
import { createGrandBouleStore } from '../stores/grandBouleStore';

export function hydrateGrandBouleMorphStateFromProject(deviceId: string): GrandBouleMorphState | null {
    const device = trackStore.value?.tracks
        .flatMap((track) => track.devices)
        .find((candidate) => candidate.id === deviceId);
    if (!device) {
        return null;
    }
    const morph = readGrandBouleMorphState(device.deviceState);
    const store = createGrandBouleStore(deviceId);
    const state = store.value;
    if (state && JSON.stringify(state.morph) !== JSON.stringify(morph)) {
        store.set({ ...state, morph });
    }
    return morph;
}
