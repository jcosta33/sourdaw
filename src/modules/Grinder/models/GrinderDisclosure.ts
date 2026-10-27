import { isRecord } from '#/utils/structuralEquality';
import {
    effectDisclosureLevel,
    effectDisclosureTierFromLevel,
    type EffectDisclosureTier,
    isEffectDisclosureStageVisible,
    isEffectDisclosureTier,
} from '#/utils/UI/effectDisclosureTier';

import { type GrinderUiSection } from './GrinderPatch';

/** Every control in a section inherits its minimum tier; sections remain cumulative. */
export const GRINDER_SECTION_TIERS: Record<GrinderUiSection, EffectDisclosureTier> = {
    browse: 'play',
    amp: 'shape',
    drive: 'build',
    cab: 'route',
    neural: 'route',
    lab: 'lab',
};

export function grinderDisclosureLevelFromState(state: unknown): 1 | 2 | 3 | 4 | 5 {
    if (!isRecord(state) || state.version !== 1 || !isRecord(state.data)) {
        return 1;
    }
    if (isEffectDisclosureTier(state.data.disclosureTier)) {
        return effectDisclosureLevel(state.data.disclosureTier);
    }
    return effectDisclosureLevel(effectDisclosureTierFromLevel(state.data.uiLevel));
}

/** A lower tier hides the section without rewriting the patch's remembered navigation. */
export function grinderVisibleSection(section: GrinderUiSection, tier: EffectDisclosureTier): GrinderUiSection {
    return isEffectDisclosureStageVisible(tier, GRINDER_SECTION_TIERS[section]) ? section : 'browse';
}
