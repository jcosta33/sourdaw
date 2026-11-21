import { digest } from '#/utils/canonicalDigest';

import { type VibeRunValueChoiceTier } from '../models/VibeRunPlan';

/**
 * The one plan digest, planner and stored-plan reader alike. The value-choice tier is a planning
 * decision the brief card disclosed, so it is bound when the plan has one; a plan stored before the
 * tier existed keeps the digest it was written with.
 */
export function digestScheduledVibeRunPlan(input: {
    briefRevision: number;
    batches: unknown;
    initialDigest: string;
    valueChoiceTier?: VibeRunValueChoiceTier;
}): string {
    const { valueChoiceTier, ...base } = input;
    if (valueChoiceTier === undefined) {
        return digest(base);
    }
    return digest({ ...base, valueChoiceTier });
}
