import { type ProofPatchSelection } from '../events/proofAppActions';
import { TARGET_LUFS } from '../models/ProofPatch';
import { getProofPatchParameterValues } from '../services/getProofPatchParameterValues';
import { isValidProofPatch } from '../services/isValidProofPatch';
import { proofTargetToInt } from '../services/proofTargetCodec';

import { getProofFactoryPreset } from './proofPresets';

export function proofPatchSelectionParameters(selection: ProofPatchSelection): Record<string, number> | null {
    if (selection.kind === 'target') {
        const { target } = selection;
        if (!Object.hasOwn(TARGET_LUFS, target)) {
            return null;
        }
        return { target_mode: proofTargetToInt(target), target_lufs: TARGET_LUFS[target] };
    }
    const preset = getProofFactoryPreset(selection.presetId);
    return preset && isValidProofPatch(preset.patch) ? getProofPatchParameterValues(preset.patch) : null;
}
