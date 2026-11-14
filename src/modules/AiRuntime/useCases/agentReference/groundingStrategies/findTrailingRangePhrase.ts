import { type ProjectContext } from '../../../models/ProjectContext';

import { findRangePhrases, RANGE_CLOSING } from './findRangePhrases';

const ONLY_CLOSING_PATTERN = new RegExp(`^${RANGE_CLOSING}`, 'u');

/** Where a closing range phrase starts in `text`, or null when the text does not end on one. */
export function findTrailingRangePhrase(text: string, context: ProjectContext): number | null {
    const trailing = findRangePhrases(text, context).find((phrase) =>
        ONLY_CLOSING_PATTERN.test(text.slice(phrase.end))
    );
    return trailing?.start ?? null;
}
