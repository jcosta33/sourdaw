import { isRecord } from '#/utils/structuralEquality';
import {
    effectDisclosureLevel,
    effectDisclosureTierFromLevel,
    isEffectDisclosureTier,
} from '#/utils/UI/effectDisclosureTier';

/** Unknown versions stay opaque; saved numeric levels retain their named meaning. */
export function proofDisclosureLevelFromState(state: unknown): 1 | 2 | 3 | 4 | 5 {
    if (!isRecord(state) || state.version !== 1 || !isRecord(state.data)) {
        return 1;
    }
    if (isEffectDisclosureTier(state.data.disclosureTier)) {
        return effectDisclosureLevel(state.data.disclosureTier);
    }
    return effectDisclosureLevel(effectDisclosureTierFromLevel(state.data.uiLevel));
}
