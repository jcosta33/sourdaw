function normalizeRestrictionText(value: string): string {
    return value
        .toLocaleLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function escapeRegExp(value: string): string {
    return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function hasReferenceOutsideMatchedIntent(text: string, intentPhrase: string, reference: string): boolean {
    const normalizedText = normalizeRestrictionText(text);
    const normalizedIntent = normalizeRestrictionText(intentPhrase);
    const normalizedReference = normalizeRestrictionText(reference);
    if (normalizedReference.length === 0) {
        return false;
    }
    const intentStart = normalizedText.indexOf(normalizedIntent);
    if (intentStart < 0) {
        return true;
    }
    const intentEnd = intentStart + normalizedIntent.length;
    const referencePattern = new RegExp(
        `(?<![\\p{L}\\p{N}])${escapeRegExp(normalizedReference)}(?![\\p{L}\\p{N}])`,
        'gu'
    );
    return [...normalizedText.matchAll(referencePattern)].some((match) => {
        const referenceStart = match.index;
        const referenceEnd = referenceStart + normalizedReference.length;
        return referenceStart < intentStart || referenceEnd > intentEnd;
    });
}
