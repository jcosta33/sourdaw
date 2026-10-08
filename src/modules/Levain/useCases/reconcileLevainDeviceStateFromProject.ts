import { trackStore } from '#/modules/Arrangement/stores';

import { fromLevainDeviceState } from '../models/LevainDeviceState';
import { levainStore, setCurrentArticulation } from '../stores/levainStore';

import { setLevainParamWithAudio } from './levainParamBridge/setLevainParamWithAudio';
import { loadInstrument } from './loadPreset';

/**
 * Apply authoritative project identity state to a loaded Levain session
 * (#4764).
 *
 * The inbound half of `initLevainDeviceStatePersistence`: the peer's commit
 * landed in the document without any local trigger firing, so this re-applies
 * the identity through the same doors a panel pick uses. An instrument change
 * rides `loadInstrument` — default patch, engine parameters, sample bank, the
 * whole route, because the peer's own pick produced exactly that — and an
 * articulation change rides `setCurrentArticulation` plus the live param door,
 * which is what `setLevainParamWithAudio` itself does. The store write leads
 * the door so the panel holds the reconciled identity even where the engine
 * door refuses (no port, torn-down node).
 *
 * A device with no session record is skipped: nothing live holds a stale
 * identity, and registration rehydrates from the document anyway.
 *
 * The identity comparison is the GB hydrate's diff gate and also the loop
 * stop — the persistence subscriber mirrors a reconciled identity back into
 * the document (an identical chunk), that write re-fires the sweep, and the
 * comparison reads equal and leaves everything untouched.
 */
export function reconcileLevainDeviceStateFromProject(deviceId: string): void {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return;
    }

    const device = tracks.flatMap((track) => track.devices).find((candidate) => candidate.id === deviceId);
    if (!device) {
        return;
    }

    const state = levainStore.value?.[deviceId];
    if (!state) {
        return;
    }

    const identity = fromLevainDeviceState(device.deviceState);
    if (!identity) {
        return;
    }

    if (
        state.patch.instrumentId === identity.instrumentId &&
        state.patch.currentArticulation === identity.currentArticulation
    ) {
        return;
    }

    if (state.patch.instrumentId !== identity.instrumentId) {
        loadInstrument(deviceId, identity.instrumentId);
    }

    if (levainStore.value?.[deviceId]?.patch.currentArticulation !== identity.currentArticulation) {
        setCurrentArticulation(deviceId, identity.currentArticulation);
        setLevainParamWithAudio(deviceId, 'currentArticulation', identity.currentArticulation);
    }
}
