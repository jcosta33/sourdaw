import { type Store } from '#/infra/store/types';
import { trackStore } from '#/modules/Arrangement/stores';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';

import { type GrandBoulePersistedState, readGrandBouleDeviceState } from '../models/GrandBouleDeviceState';
import { type GrandBouleMorphState } from '../models/GrandBouleMorphState';
import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../stores/grandBouleStore';

import { applyGrandBouleMorphState } from './applyGrandBouleMorphState';
import { commitGrandBouleDeviceState } from './commitGrandBouleDeviceState';

/**
 * Read the device's persisted state the way `commitGrandBouleDeviceState`'s
 * before-side does: fresh from the track's current chunk, with the decoder's
 * defaults when the device or its chunk is absent. The session store is a
 * mirror another peer's device-state action can leave behind, so a commit that
 * sourced the untouched leaves from it would clobber project truth with the
 * stale copy — the temperament the chunk holds must survive a morph drag it
 * never took part in.
 */
function projectGrandBouleState(deviceId: string): GrandBoulePersistedState {
    const device = trackStore.value?.tracks
        .flatMap((track) => track.devices)
        .find((candidate) => candidate.id === deviceId && candidate.type === DEVICE_TYPE_IDS.grandBoule);
    return readGrandBouleDeviceState(device?.deviceState);
}

export function dispatchGrandBouleMorphEdit(input: {
    deviceId: string;
    engine: GrandBouleEngineHandle;
    store: Store<GrandBouleState>;
    nextMorph: GrandBouleMorphState;
    isTransient: boolean;
}): void {
    const state = input.store.value;
    if (state === null) {
        return;
    }
    if (input.isTransient) {
        if (!applyGrandBouleMorphState(input.engine, input.nextMorph)) {
            return;
        }
        input.store.set({ ...state, morph: input.nextMorph });
        return;
    }
    const projectState = projectGrandBouleState(input.deviceId);
    commitGrandBouleDeviceState(input.deviceId, {
        morph: input.nextMorph,
        temperament: projectState.temperament,
        parameters: projectState.parameters,
    });
}
