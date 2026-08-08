import { trackStore } from '#/modules/Arrangement/stores';

import { createGrandBouleStore } from '../stores/grandBouleStore';

import { GRAND_BOULE_PERSISTED_PARAM_IDS } from './grandBouleParamBridge/helpers';

/**
 * Seed a device's session config from the knob values project truth holds.
 *
 * The read-back half of `dispatchGrandBouleParam`, and the half that makes a moved
 * knob survive a reload. `projectTrackToLiveStrip` already replays
 * `Device.parameterValues` into the engine on project open, so without this the
 * piano would sound at its saved master gain while the panel drew 70% — and the
 * first touch of any Mix knob would push that stale default back over the saved
 * value, silently discarding it.
 *
 * Idempotent and default-only. A parameter absent from `parameterValues` leaves the
 * store field alone: absence is the normal state for a device nobody has touched
 * and for any project saved before knobs were persisted at all, and neither is a
 * reason to overwrite what the store holds.
 *
 * Runs against the store rather than returning a state because
 * `createGrandBouleStore` is a per-device `createStore` held in a module `Map` — the
 * panel does not construct the state, it subscribes to that instance.
 */
export function hydrateGrandBouleConfigFromProject(deviceId: string): void {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return;
    }

    const device = tracks.flatMap((track) => track.devices).find((candidate) => candidate.id === deviceId);
    if (!device) {
        return;
    }

    const store = createGrandBouleStore(deviceId);
    const state = store.value;
    if (state === null) {
        return;
    }

    const restored: Record<string, number> = {};
    for (const paramId of GRAND_BOULE_PERSISTED_PARAM_IDS) {
        const stored = device.parameterValues[paramId];
        if (typeof stored === 'number' && Number.isFinite(stored)) {
            restored[paramId] = stored;
        }
    }

    if (Object.keys(restored).length === 0) {
        return;
    }

    store.set({ ...state, config: { ...state.config, ...restored } });
}
