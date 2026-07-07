import { type TempoMapResult } from '../../../models/TempoMappingTypes';

import { applyTempoMap } from './applyTempoMap';
import { detectTempoFromOnsets } from './detectTempoFromOnsets';
import { estimateOnsetsFromClips } from './estimateOnsetsFromClips';

/**
 * Run full tempo detection on the current project.
 */
export function detectProjectTempo(): TempoMapResult {
    const onsets = estimateOnsetsFromClips();
    const result = detectTempoFromOnsets(onsets);

    if (result.confidence > 0.5) {
        applyTempoMap(result);
    }

    return result;
}
