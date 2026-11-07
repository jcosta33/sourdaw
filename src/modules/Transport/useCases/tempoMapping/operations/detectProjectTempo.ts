import { type TempoMapResult } from '../../../models/TempoMappingTypes';

import { detectTempoFromOnsets } from './detectTempoFromOnsets';
import { estimateOnsetsFromClips } from './estimateOnsetsFromClips';

/**
 * Estimate the current project's tempo. Adopting the result is an explicit
 * tempo command, which owns source preservation and Undo.
 */
export function detectProjectTempo(): TempoMapResult {
    const onsets = estimateOnsetsFromClips();
    return detectTempoFromOnsets(onsets);
}
