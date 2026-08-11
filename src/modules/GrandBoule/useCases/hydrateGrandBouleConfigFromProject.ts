import { trackStore } from '#/modules/Arrangement/stores';

import { createDefaultGrandBouleConfig } from '../models/GrandBouleConfig';
import { createGrandBouleStore } from '../stores/grandBouleStore';

import { GRAND_BOULE_PERSISTED_PARAM_IDS } from './grandBouleParamBridge/helpers';
import { normalizeGrandBoulePersistedParamValue } from './normalizeGrandBoulePersistedParamValue';

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
 * Idempotent and project-authoritative. A parameter absent from
 * `parameterValues` restores its module default, so undo of a first write and
 * legacy-project hydration cannot retain a transient value from newer state.
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

    const defaults = createDefaultGrandBouleConfig();
    const restored: Record<string, number> = {};
    for (const paramId of GRAND_BOULE_PERSISTED_PARAM_IDS) {
        restored[paramId] = normalizeGrandBoulePersistedParamValue({
            defaultValue: defaults[paramId],
            paramId,
            value: device.parameterValues[paramId],
        });
    }

    const unchanged = GRAND_BOULE_PERSISTED_PARAM_IDS.every((paramId) => state.config[paramId] === restored[paramId]);
    if (unchanged) {
        return;
    }

    store.set({ ...state, config: { ...state.config, ...restored } });
}
