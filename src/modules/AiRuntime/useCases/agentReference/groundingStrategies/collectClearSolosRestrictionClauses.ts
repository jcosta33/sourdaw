const clearSolosRestrictionStartPattern =
    /\b(?:except|excluding|besides|minus|(?:other|rather)\s+than|apart\s+from|save\s+for|with\s+(?:the\s+)?exception\s+of|all\s+but|but\s+not|not\s+including|(?:but|and)\s+(?:keep|leave|preserve|retain)|keep|leave|preserve|retain)\b/giu;

export function collectClearSolosRestrictionClauses(text: string): string[] {
    const clauses: string[] = [];
    for (const match of text.matchAll(clearSolosRestrictionStartPattern)) {
        if (match.index === undefined) {
            continue;
        }
        const remainingText = text.slice(match.index + match[0].length);
        const nextClause = /\s+(?:and|but)\s+|[;,\n]+/iu.exec(remainingText);
        const end = nextClause ? match.index + match[0].length + nextClause.index : text.length;
        const clause = text.slice(match.index, end).trim();
        if (clause.length > 0) {
            clauses.push(clause);
        }
    }
    return clauses;
}
