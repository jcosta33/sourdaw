import { type TempoMapResult } from '../../../models/TempoMappingTypes';
import { getTransportState } from '../../../repositories/transport/getTransportState';

import { detectTempoFromOnsets } from './detectTempoFromOnsets';
import { estimateOnsetsFromClips } from './estimateOnsetsFromClips';
import { normalizeDetectedTempo } from './normalizeDetectedTempo';

/**
 * Run full tempo detection on the current project.
 */
export function detectProjectTempo(): TempoMapResult & { normalizedBpm: number | null } {
    const onsets = estimateOnsetsFromClips();
    const result = detectTempoFromOnsets(onsets);

    return {
        ...result,
        normalizedBpm: result.confidence > 0.5 ? normalizeDetectedTempo(result, getTransportState() !== null) : null,
    };
}
