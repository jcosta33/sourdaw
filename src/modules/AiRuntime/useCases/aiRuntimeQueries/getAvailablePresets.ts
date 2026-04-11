import { getAvailablePresets as getAvailableInternalPresets } from '../../services/fuzzySearch';
import type { PresetSearchContext, PromptPreset } from './helpers';
import { toPromptPreset } from './helpers';

export function getAvailablePresets(context: PresetSearchContext): PromptPreset[] {
    return getAvailableInternalPresets(context).map(toPromptPreset);
}