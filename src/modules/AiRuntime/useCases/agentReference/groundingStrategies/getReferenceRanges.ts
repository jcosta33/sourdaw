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
    return Array.from(commandSource.matchAll(pattern), (match) => ({
        start: match.index,
        end: match.index + match[0].length,
    }));
}
