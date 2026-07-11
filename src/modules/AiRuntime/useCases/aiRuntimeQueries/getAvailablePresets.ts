import { type PresetContext } from '../../models/PresetActions/Registry';
import { type PromptPreset } from '../../models/PromptPreset';
import { getAvailablePresets as getAvailableInternalPresets } from '../../services/fuzzySearch';

import { toPromptPreset } from './toPromptPreset';

export function getAvailablePresets(context: PresetContext): PromptPreset[] {
    return getAvailableInternalPresets(context).map(toPromptPreset);
}
