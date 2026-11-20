/** Why a batch expands at its catalogue defaults rather than at values the provider chose. */
export type VibeBatchDefaultsReason = 'local-backend' | 'declined' | 'failed' | 'correction-exhausted' | 'budget';

/**
 * Where a vibe batch card's recipe values came from, as its card states it: chosen from the targets'
 * measurements, or kept at the catalogue defaults for a reason the card names. A re-preview reads it
 * back to compose the card again without asking for values a second time.
 */
export type VibeBatchValueSource =
    | { readonly source: 'measurements' }
    | { readonly source: 'catalogue-defaults'; readonly reason: VibeBatchDefaultsReason; readonly detail: string };
