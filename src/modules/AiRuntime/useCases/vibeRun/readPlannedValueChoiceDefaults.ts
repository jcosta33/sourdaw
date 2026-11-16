import { type VibeRunValueChoiceTier } from '../../models/VibeRunPlan';

import { isHostedValueChoiceChain } from './isHostedValueChoiceChain';

/**
 * Why a batch keeps its catalogue defaults without asking, or `null` when the provider may be asked:
 * only a run planned hosted, whose live chain is still hosted. The brief card disclosed the value
 * calls and the whole-run token fit ran at plan time, so a run planned locally never calls a hosted
 * provider, and a hosted plan whose chain changed no longer does.
 */
export function readPlannedValueChoiceDefaults(
    plannedTier: VibeRunValueChoiceTier
): { reason: 'local-backend' | 'planned-local'; detail: string } | null {
    const liveHosted = isHostedValueChoiceChain();
    const changed = 'the AI backend changed since this run was planned';
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
