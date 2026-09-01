const clearSolosRestrictionStartPattern =
    /\b(?:except|excluding|besides|minus|(?:other|rather)\s+than|apart\s+from|save\s+for|with\s+(?:the\s+)?exception\s+of|all\s+but|but\s+not|not\s+including|(?:(?:but|and|while)\s+)?(?:keep(?:ing)?|leav(?:e|ing)|preserv(?:e|ing)|retain(?:ing)?))\b/giu;

const clearSolosIntentPattern = /\b(?:clear\s+all\s+solos|unsolo\s+all\s+tracks|unsolo\s+everything)\b/giu;
const clearSolosContinuativePattern = /(?:keep(?:ing)?|leav(?:e|ing)|preserv(?:e|ing)|retain(?:ing)?)/iu;
const clearSolosStatePattern = /\bsolo(?:ed)?\b/iu;
const nextActionPattern =
    /\s+(?:and|but)\s+(?=(?:add|arm|bypass|clear|copy|create|delete|disable|duplicate|enable|insert|join|move|mute|nudge|normalize|remove|rename|route|send|set|solo|split|trim|unmute|unsolo)\b)|[;,\n]+/iu;
const bulkTrackTargetListPattern = /\b(?:mute|unmute|solo|unsolo)\s+(?:all|every)\s+tracks?\s*$/iu;

function hasClearSolosIntentBefore(text: string, index: number): boolean {
    return [...text.slice(0, index).matchAll(clearSolosIntentPattern)].length > 0;
}

function isOwnedByBulkTrackAction(text: string, index: number): boolean {
    return bulkTrackTargetListPattern.test(text.slice(0, index));
}

export function collectClearSolosRestrictionClauses(text: string): string[] {
    const clauses: string[] = [];
    for (const match of text.matchAll(clearSolosRestrictionStartPattern)) {
        if (match.index === undefined) {
            continue;
        }
        if (!hasClearSolosIntentBefore(text, match.index)) {
            continue;
        }
        const remainingText = text.slice(match.index + match[0].length);
        const nextClause = nextActionPattern.exec(remainingText);
        const end = nextClause ? match.index + match[0].length + nextClause.index : text.length;
        const clause = text.slice(match.index, end).trim();
        const isContinuative = clearSolosContinuativePattern.test(match[0]);
        if (
            clause.length > 0 &&
            (!isContinuative || clearSolosStatePattern.test(clause)) &&
            (isContinuative || !isOwnedByBulkTrackAction(text, match.index))
        ) {
            clauses.push(clause);
        }
    }
    return clauses;
}
