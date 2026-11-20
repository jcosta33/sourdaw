import { type ProofPatch } from '../../models/ProofPatch';
import { getProofPatchParameterValues } from '../../services/getProofPatchParameterValues';
import { getRestoredProofPatch } from '../../services/getRestoredProofPatch';
import { getProofState, hydrateProofPatch } from '../../stores/proofStore';
import { PROOF_PRESETS } from '../proofPresets';

import { getRestoredProofParameterValues } from './getRestoredProofParameterValues';

function getMatchingProofPreset(patch: ProofPatch) {
    const values = getProofPatchParameterValues(patch);
    const keys = Object.keys(values);

    const matches = PROOF_PRESETS.filter((preset) => {
        const presetValues = getProofPatchParameterValues(preset.patch);
        return (
            keys.length === Object.keys(presetValues).length && keys.every((key) => values[key] === presetValues[key])
        );
    });

    return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Hydrate the store from the device's persisted parameter row, once. No engine
 * writes: a natively carried body already holds the persisted record from its
 * own load, and a web twin still forming its bridge has nothing yet to write
 * to. The caller sends only the edit; the full sync that reaches the engine
 * runs later, at bridge registration.
 */
export function rehydrateRestoredPatch(deviceId: string): void {
    const state = getProofState(deviceId);
    if (state.projectPatchHydrated) {
        return;
    }

    const parameterValues = getRestoredProofParameterValues(deviceId);
    if (!parameterValues) {
        return;
    }

    const restoredPatch = getRestoredProofPatch(parameterValues, state.patch);
    const matchingPreset = getMatchingProofPreset(restoredPatch);
    hydrateProofPatch({
        deviceId,
        patch: {
            ...restoredPatch,
            name: matchingPreset?.name ?? restoredPatch.name,
            presetId: matchingPreset?.id,
        },
    });
}
