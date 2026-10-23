import { refinementCourtesy } from '../refinementCourtesy';

import { normalizePromptText } from './normalizePromptText';

/** "instead" restricts or replaces what stands beside it, so it is not courtesy in a fresh request. */
const RESTRICTION_FILLER = 'instead';

/** A clause that is exactly one entry of the closed courtesy list ("please", "thanks", "ok") and asks for nothing. */
export function isFillerClause(maskedClause: string): boolean {
    const normalized = normalizePromptText(maskedClause);
    return normalized !== RESTRICTION_FILLER && refinementCourtesy.filler.has(normalized);
}
