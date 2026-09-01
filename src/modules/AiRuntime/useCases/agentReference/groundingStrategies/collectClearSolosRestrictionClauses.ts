const clearSolosRestrictionStartPattern =
    /\b(?:except|excluding|besides|minus|(?:other|rather)\s+than|apart\s+from|save\s+for|with\s+(?:the\s+)?exception\s+of|all\s+but|but\s+not|not\s+including|(?:(?:but|and|while)\s+)?(?:keep(?:ing)?|leav(?:e|ing)|preserv(?:e|ing)|retain(?:ing)?))\b/giu;

const clearSolosIntentPattern = /\b(?:clear\s+all\s+solos|unsolo\s+all\s+tracks|unsolo\s+everything)\b/iu;
const clearSolosContinuativePattern = /(?:keep(?:ing)?|leav(?:e|ing)|preserv(?:e|ing)|retain(?:ing)?)/iu;
const clearSolosStatePattern = /\bsolo(?:ed)?\b/iu;
const bulkTrackScopePattern = /\b(?:all|every)\s+tracks?\b/iu;
const bulkTrackActionTypes: ReadonlySet<string> = new Set(['muteTrack', 'soloTrack']);

export type ClearSolosRestrictionActionSpan = {
    actionType: string;
    end: number;
    start: number;
};

function getOwningActionSpan(
    actionSpans: readonly ClearSolosRestrictionActionSpan[],
    index: number
): ClearSolosRestrictionActionSpan | null {
    return actionSpans.find((span) => span.start <= index && index < span.end) ?? null;
}

function isOwnedByAdjacentBulkTrackAction(
    text: string,
    restrictionIndex: number,
    owner: ClearSolosRestrictionActionSpan | null
): boolean {
    if (!owner || !bulkTrackActionTypes.has(owner.actionType)) {
        return false;
    }
    return bulkTrackScopePattern.test(text.slice(owner.start, restrictionIndex));
}

export function collectClearSolosRestrictionClauses(
    text: string,
    actionSpans: readonly ClearSolosRestrictionActionSpan[] = [{ actionType: 'clearSolos', start: 0, end: text.length }]
): string[] {
    const restrictions = [...text.matchAll(clearSolosRestrictionStartPattern)];
    const clauses: string[] = [];
    for (const [index, match] of restrictions.entries()) {
        if (match.index === undefined || !clearSolosIntentPattern.test(text.slice(0, match.index))) {
            continue;
        }
        const owner = getOwningActionSpan(actionSpans, match.index);
        const nextRestriction = restrictions[index + 1];
        const end = Math.min(owner?.end ?? text.length, nextRestriction?.index ?? text.length);
        const clause = text.slice(match.index, end).trim();
        const isContinuative = clearSolosContinuativePattern.test(match[0]);
        if (clause.length === 0 || (isContinuative && !clearSolosStatePattern.test(clause))) {
            continue;
        }
        if (
            isContinuative ||
            owner?.actionType === 'clearSolos' ||
            !isOwnedByAdjacentBulkTrackAction(text, match.index, owner)
        ) {
            clauses.push(clause);
        }
    }
    return clauses;
}
