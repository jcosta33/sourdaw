export type CancellationCue = {
    index: number;
    text: string;
};

export function getCancellationCues(text: string): CancellationCue[] {
    const patterns = [
        /\b(?:never mind|on second thought|actually\s*,?\s+no)\b/gu,
        /\b(?:abort|cancel|disregard|scratch)\s+(?:it\b|(?:that|this)\b(?!\s+\p{L})|(?:the|that|this)\s+(?:\p{L}+\s+){0,2}(?:change|command|request)\b)/gu,
        /\bleave\s+(?:(?:it|that|this)\s+)?unchanged\b/gu,
        /\b(?:do not|don['’]t|don t|dont|never|not)\b(?:\s+\p{L}+){0,3}\s+(?:apply|change|do|execute|make)\s+(?:it\b|(?:that|this)\b(?!\s+\p{L})|(?:the|that|this)\s+(?:\p{L}+\s+){0,2}(?:change|command|request)\b)/gu,
    ];
    return patterns.flatMap((pattern) =>
        [...text.matchAll(pattern)].map((match) => ({ index: match.index, text: match[0] }))
    );
}
