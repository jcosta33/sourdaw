/** One parameter value as recipe expansion takes it. */
export type VibeBatchChosenValue = { readonly step: number; readonly paramId: string; readonly value: number };

/** The values one recipe-and-track pair of the batch expands with. */
export type VibeBatchPairValues = {
    readonly targetId: string;
    readonly recipeId: string;
    readonly values: readonly VibeBatchChosenValue[];
};

/** Why a batch expands at its catalogue defaults rather than at values the provider chose. */
export type VibeBatchDefaultsReason = 'local-backend' | 'declined' | 'failed' | 'correction-exhausted' | 'budget';

/**
 * The values a vibe batch expands with: chosen from the targets' measurements, or kept at the
 * catalogue defaults for a reason the card names. Its approval snapshot records it, so a re-preview
 * composes the card again without asking for values a second time.
 */
export type VibeBatchValueChoice =
    | { readonly source: 'measurements'; readonly pairs: readonly VibeBatchPairValues[] }
    | { readonly source: 'catalogue-defaults'; readonly reason: VibeBatchDefaultsReason; readonly detail: string };
