const trackControlRestrictionPatterns: readonly RegExp[] = [
    /\b(?:except|excluding|besides|minus)\b/u,
    /\b(?:other|rather)\s+than\b/u,
    /\bapart\s+from\b/u,
    /\bsave\s+for\b/u,
    /\bwith\s+(?:the\s+)?exception\s+of\b/u,
    /\b(?:all\s+but|but\s+not|not\s+including)\b/u,
    /\b(?:keep|leave|preserve|retain)\b/u,
];

export function hasTrackControlRestriction(prompt: string): boolean {
    const restrictionEvidence = prompt
        .toLocaleLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
    return trackControlRestrictionPatterns.some((pattern) => pattern.test(restrictionEvidence));
}

/** Where each restriction phrase begins in the text, in order, read with the same vocabulary. */
export function findTrackControlRestrictionStarts(text: string): number[] {
    const lowered = text.toLowerCase();
    return trackControlRestrictionPatterns
        .flatMap((pattern) => [...lowered.matchAll(new RegExp(pattern.source, 'gu'))].map((match) => match.index))
        .sort((left, right) => left - right);
}
