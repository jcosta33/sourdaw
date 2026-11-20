import { valuesEqual } from '#/utils/structuralEquality';

import { type ProofPatchSelection, type ProofPatchSelectionSnapshot } from '../../events/proofAppActions';
import { DEFAULT_PATCH, type ProofPatch } from '../../models/ProofPatch';
import { getProofPatchParameterValues } from '../../services/getProofPatchParameterValues';
import { getProofState, updateProofPatch } from '../../stores/proofStore';
import { getProofFactoryPreset } from '../proofPresets';

import { loadProofPatchWithAudio } from './loadProofPatchWithAudio';
import { proofLimiterCeiling } from './proofLimiterCeiling';
import {
    getRestoredProofParameterValues,
    getRestoredProofPatch,
    readRestoredProofTarget,
    rehydrateRestoredPatch,
} from './rehydrateRestoredPatch';

function matchingPresetId(patch: ProofPatch, presetId: string | null): string | undefined {
    if (presetId === null) {
        return undefined;
    }
    const preset = getProofFactoryPreset(presetId);
    return preset && valuesEqual(getProofPatchParameterValues(patch), getProofPatchParameterValues(preset.patch))
        ? preset.id
        : undefined;
}

function restoredTargetPresetId(deviceId: string, presetId: string | null): string | undefined {
    if (presetId === null) {
        return undefined;
    }
    const parameters = getRestoredProofParameterValues(deviceId);
    return parameters ? matchingPresetId(getRestoredProofPatch(parameters, DEFAULT_PATCH), presetId) : undefined;
}

export function syncProofPatchSelection(
    deviceId: string,
    selection: ProofPatchSelection,
    snapshot: ProofPatchSelectionSnapshot
): void {
    if (selection.kind === 'target') {
        // Targets annotate the mastering readout only. Leave processing and previews in place.
        rehydrateRestoredPatch(deviceId);
        const { target, targetLufs } = readRestoredProofTarget(snapshot.parameters) ?? DEFAULT_PATCH;
        const presetId = restoredTargetPresetId(deviceId, snapshot.presetId);
        const current = getProofState(deviceId).patch;
        updateProofPatch({
            deviceId,
            patch: { target, targetLufs, presetId, name: presetId ? snapshot.name : current.name },
        });
        return;
    }

    const parameters = Object.fromEntries(
        Object.entries(snapshot.parameters).filter((entry): entry is [string, number] => entry[1] !== null)
    );
    // Missing keys restore the same defaults as reopening, even if a preset just filled them.
    const patch = getRestoredProofPatch(parameters, DEFAULT_PATCH);
    const presetId = matchingPresetId(patch, snapshot.presetId);
    proofLimiterCeiling.cancelHeld(deviceId);
    loadProofPatchWithAudio({ deviceId, patch: { ...patch, name: snapshot.name, presetId } });
}
