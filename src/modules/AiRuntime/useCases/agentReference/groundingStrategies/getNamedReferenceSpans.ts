import { type PromptReferenceSpan } from './bindDecibelFiguresToReferences';
import { getReferenceRanges } from './getReferenceRanges';
import { normalizePromptText } from './normalizePromptText';

function matchedLength(name: string): number {
    return normalizePromptText(name).length;
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
