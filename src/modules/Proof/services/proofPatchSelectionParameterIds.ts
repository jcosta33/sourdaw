import { DEFAULT_PATCH } from '../models/ProofPatch';

import { getProofPatchParameterValues } from './getProofPatchParameterValues';

const TARGET_PARAMETER_IDS = ['target_mode', 'target_lufs'];
const PATCH_PARAMETER_IDS = Object.keys(getProofPatchParameterValues(DEFAULT_PATCH));

export function proofPatchSelectionParameterIds(kind: 'target' | 'preset'): readonly string[] {
    return kind === 'target' ? TARGET_PARAMETER_IDS : PATCH_PARAMETER_IDS;
}
