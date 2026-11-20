import { type VibeRunValueChoiceTier } from '../../models/VibeRunPlan';

import { isHostedValueChoiceChain } from './isHostedValueChoiceChain';

/** A plan stored before its tier was recorded has no disclosed tier to follow; it is never persisted into a plan. */
export type PlannedValueChoiceTier = VibeRunValueChoiceTier | 'unrecorded';

/**
 * Why a batch keeps its catalogue defaults without asking, or `null` when the provider may be asked:
 * only a run planned hosted, whose live chain is still hosted. The brief card disclosed the value
 * calls and the whole-run token fit ran at plan time, so a run planned locally never calls a hosted
 * provider, a hosted plan whose chain changed no longer does, and a plan whose tier was never
 * recorded cannot show it disclosed any call.
 */
export function readPlannedValueChoiceDefaults(
    plannedTier: PlannedValueChoiceTier
): { reason: 'local-backend' | 'planned-local' | 'tier-unrecorded'; detail: string } | null {
    const liveHosted = isHostedValueChoiceChain();
    const changed = 'the AI backend changed since this run was planned';
    if (plannedTier === 'unrecorded') {
        return { reason: 'tier-unrecorded', detail: '' };
    }
    if (plannedTier === 'hosted' && liveHosted) {
        return null;
    }
    if (plannedTier === 'hosted') {
        return { reason: 'local-backend', detail: changed };
    }
    if (liveHosted) {
        return { reason: 'planned-local', detail: changed };
    }
    return { reason: 'local-backend', detail: 'the run is not on a hosted backend' };
}
