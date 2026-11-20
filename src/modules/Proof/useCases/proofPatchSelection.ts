import { type ProofPatchSelection } from '../events/proofAppActions';
import { DEFAULT_PATCH, TARGET_LUFS } from '../models/ProofPatch';
import { getProofPatchParameterValues } from '../services/getProofPatchParameterValues';
import { isValidProofPatch } from '../services/isValidProofPatch';
import { proofTargetToInt } from '../services/proofTargetCodec';

import { getProofFactoryPreset } from './proofPresets';

const TARGET_PARAMETER_IDS = ['target_mode', 'target_lufs'];
const PATCH_PARAMETER_IDS = Object.keys(getProofPatchParameterValues(DEFAULT_PATCH));

export function proofPatchSelectionParameterIds(selection: ProofPatchSelection): readonly string[] {
    return selection.kind === 'target' ? TARGET_PARAMETER_IDS : PATCH_PARAMETER_IDS;
}

export function proofPatchSelectionParameters(selection: ProofPatchSelection): Record<string, number> | null {
    if (selection.kind === 'target') {
        const { target } = selection;
        return Object.hasOwn(TARGET_LUFS, target)
            ? { target_mode: proofTargetToInt(target), target_lufs: TARGET_LUFS[target] }
            : null;
    }
    const preset = getProofFactoryPreset(selection.presetId);
    return preset && isValidProofPatch(preset.patch) ? getProofPatchParameterValues(preset.patch) : null;
}
