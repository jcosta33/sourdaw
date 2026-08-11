import { trackStore } from '#/modules/Arrangement/stores';

import {
    BOOLEAN_ENGINE_FIELDS,
    NUMERIC_ENGINE_FIELDS,
    PARAM_MAP,
    proofChamberAlgorithmFromWireValue,
    type ProofChamberEngineState,
} from '../../models/ProofChamberState';
import { chamberStore } from '../../stores/chamberStore';

/**
 * Seed a Dutch Oven's session state from the parameter values project truth
 * holds.
 *
 * The read-back half of the panel's writes, and the half that makes a saved
 * reverb survive a reload. Without it `chamberStore` starts every session at
 * `DEFAULT_PARAMS` — two writers, both panel-driven, and no projection from the
 * CRDT back into the store — so a project saved on Reverse reopened drawing
 * Plate while the engine, which *is* replayed from `Device.parameterValues` by
 * `projectTrackToLiveStrip`, ran Reverse.
 *
 * Since #1519 that mismatch is worse than a wrong label. The panel gates its
 * controls on `params.algorithm` read out of this store, so a project saved on
 * Reverse reopened as Plate offered all fifteen controls the reverse engine
 * cannot hear, fully interactive, with no explanation — precisely the defect
 * the gating exists to end, reintroduced on every project open.
 *
 * Idempotent and default-only, matching `hydrateGrandBouleConfigFromProject`: a
 * parameter absent from `parameterValues` leaves the store field alone, because
 * absence is the normal state for a device nobody has touched and for any
 * project saved before a given parameter was persisted.
 *
 * This is the *reload* half of the projection only. A peer's write and an undo
 * of an algorithm change both move project truth without remounting the panel,
 * and neither reaches this function — see the PR body; a live CRDT → store
 * subscription for ProofChamber is its own piece of work.
 */
export function hydrateChamberStateFromProject(deviceId: string): void {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return;
    }

    const device = tracks.flatMap((track) => track.devices).find((candidate) => candidate.id === deviceId);
    if (!device) {
        return;
    }

    const state = chamberStore.value;
    const instance = state?.instances[deviceId];
    if (!state || !instance) {
        return;
    }

    const restored: ProofChamberEngineState = { ...instance.engineState };
    let changed = false;

    for (const field of NUMERIC_ENGINE_FIELDS) {
        const paramId = PARAM_MAP[field];
        if (paramId === undefined) {
            continue;
        }
        const stored = device.parameterValues[paramId];
        if (typeof stored === 'number' && Number.isFinite(stored)) {
            restored[field] = stored;
            changed = true;
        }
    }

    for (const field of BOOLEAN_ENGINE_FIELDS) {
        const paramId = PARAM_MAP[field];
        if (paramId === undefined) {
            continue;
        }
        const stored = device.parameterValues[paramId];
        if (typeof stored === 'number' && Number.isFinite(stored)) {
            // The switches persist as the 0/1 the engine reads, and
            // `ProofChamber::set_param` treats anything above 0.5 as on.
            restored[field] = stored > 0.5;
            changed = true;
        }
    }

    const storedAlgorithm = device.parameterValues.algorithm;
    if (typeof storedAlgorithm === 'number' && Number.isFinite(storedAlgorithm)) {
        restored.algorithm = proofChamberAlgorithmFromWireValue(storedAlgorithm);
        changed = true;
    }

    if (!changed) {
        return;
    }

    chamberStore.set({
        ...state,
        instances: {
            ...state.instances,
            [deviceId]: { ...instance, engineState: restored },
        },
    });
}
