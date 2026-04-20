import { getAvailablePresets as getAvailableInternalPresets } from '../../services/fuzzySearch';

import { toPromptPreset } from './helpers';

import type { PresetSearchContext, PromptPreset } from './helpers';

export function getAvailablePresets(context: PresetSearchContext): PromptPreset[] {
    return getAvailableInternalPresets(context).map(toPromptPreset);
}
