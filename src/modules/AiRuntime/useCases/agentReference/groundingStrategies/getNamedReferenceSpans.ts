import { type PromptReferenceSpan } from './bindDecibelFiguresToReferences';
import { escapeRegExp } from './escapeRegExp';
import { normalizePromptText } from './normalizePromptText';

export type ReferenceRange = {
    end: number;
    start: number;
};

export function getReferenceRanges(commandSource: string, reference: string): ReferenceRange[] {
    const referenceTokens = normalizePromptText(reference).split(' ').filter(Boolean);
    if (referenceTokens.length === 0) {
        return [];
    }
    const normalizedReferencePattern = referenceTokens.map(escapeRegExp).join('[^\\p{L}\\p{N}]+');
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${normalizedReferencePattern}(?![\\p{L}\\p{N}])`, 'giu');
    return [...commandSource.matchAll(pattern)].map((match) => ({
        start: match.index,
        end: match.index + match[0].length,
    }));
}

/**
 * Every named project object the scope text names, longest name first, one span per stretch of text.
 * A name is as long as the words {@link getReferenceRanges} matches, so symbols it never matches ("Chorus
 * ***") cannot rank a shorter name above a longer one ("Chorus 2").
 */
export function getNamedReferenceSpans(
    scopeText: string,
    objects: readonly { id: string; name: string }[]
): PromptReferenceSpan[] {
    const matchedLength = (name: string) => normalizePromptText(name).length;
    const spans: PromptReferenceSpan[] = [];
    for (const object of objects.toSorted((left, right) => matchedLength(right.name) - matchedLength(left.name))) {
        for (const range of getReferenceRanges(scopeText, object.name)) {
            if (spans.some((span) => range.start < span.end && range.end > span.start)) {
                continue;
            }
            spans.push({ ...range, id: object.id });
        }
    }
    return spans;
}
