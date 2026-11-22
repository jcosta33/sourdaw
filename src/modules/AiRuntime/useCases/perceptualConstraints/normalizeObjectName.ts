import { LEADING_DETERMINER, QUOTE_MARK } from './constraintClauseWords';
import { normalizePhrase } from './normalizePhrase';

/**
 * An object's name as a track's name is matched against: its brackets kept, since they are part of a
 * name, so "Bass DI" never names Bass (DI). `normalizeObjectText` reads its words without them.
 */
export function normalizeObjectName(text: string): string {
    return normalizePhrase(text.replaceAll(QUOTE_MARK, '')).replace(LEADING_DETERMINER, '');
}
