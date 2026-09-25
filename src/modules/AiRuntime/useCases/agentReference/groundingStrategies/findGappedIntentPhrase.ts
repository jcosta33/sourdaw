import { escapeRegExp } from './escapeRegExp';
import { normalizePromptText } from './normalizePromptText';

export type GappedIntentPhraseMatch = {
    /** Where the phrase's first word starts in the clause's normalized text. */
    index: number;
    /** Where the phrase's last word ends in the clause itself. */
    end: number;
};

export type IntentPhraseGaps = {
    /** One masked project reference, optionally after an article, may sit between two words of the phrase. */
    maskedReference: boolean;
    /** Names a creation proposes; one of them, as the clause writes it, may sit between two words of the phrase. */
    proposedNames: readonly string[];
};

/** Spacing and punctuation, never a masked reference. */
const GAP_SEPARATOR = '[^\\p{L}\\p{N}□]+';

/** `maskProjectReferences.ts` writes each project reference as one run of mask glyphs, a clip name after `clip`. */
const MASKED_REFERENCE_GAP = `${GAP_SEPARATOR}(?:(?:the|an|a)${GAP_SEPARATOR})?(?:clip)?□+${GAP_SEPARATOR}`;

/** Compiled masked-reference patterns, keyed by source; registry phrases bound their number. */
const maskedReferencePatterns = new Map<string, RegExp>();

function getGappedPhrasePattern(head: string, gap: string, tail: string): RegExp {
    const source = `(?<![\\p{L}\\p{N}])${head}${gap}${tail}(?![\\p{L}\\p{N}])`;
    if (gap !== MASKED_REFERENCE_GAP) {
        return new RegExp(source, 'iu');
    }
    const cached = maskedReferencePatterns.get(source);
    if (cached) {
        return cached;
    }
    const pattern = new RegExp(source, 'iu');
    maskedReferencePatterns.set(source, pattern);
    return pattern;
}

function getWordsPattern(words: readonly string[]): string {
    return words.map((word) => escapeRegExp(word)).join(GAP_SEPARATOR);
}

function getProposedNameGap(name: string): string | null {
    const words = normalizePromptText(name).split(' ').filter(Boolean);
    if (words.length === 0) {
        return null;
    }
    return `${GAP_SEPARATOR}${words.map((word) => escapeRegExp(word)).join('[^\\p{L}\\p{N}]+')}${GAP_SEPARATOR}`;
}

/**
 * The earliest place a multi-word intent phrase occurs in a clause with exactly one admitted gap
 * between two of its words: "turn the Bass DI down" for "turn down", or "create a Bass Crush bus"
 * for "create a bus" when the creation proposes that name. A gap of any other words never matches.
 */
export function findGappedIntentPhrase(
    text: string,
    intentPhrase: string,
    gaps: IntentPhraseGaps
): GappedIntentPhraseMatch | null {
    const words = normalizePromptText(intentPhrase).split(' ').filter(Boolean);
    const gapPatterns = gaps.proposedNames.flatMap((name) => getProposedNameGap(name) ?? []);
    if (gaps.maskedReference) {
        gapPatterns.unshift(MASKED_REFERENCE_GAP);
    }
    let earliest: RegExpExecArray | null = null;
    for (let split = 1; split < words.length; split += 1) {
        const head = getWordsPattern(words.slice(0, split));
        const tail = getWordsPattern(words.slice(split));
        for (const gap of gapPatterns) {
            const match = getGappedPhrasePattern(head, gap, tail).exec(text);
            if (match && (earliest === null || match.index < earliest.index)) {
                earliest = match;
            }
        }
    }
    if (!earliest) {
        return null;
    }
    const normalizedPrefix = normalizePromptText(text.slice(0, earliest.index));
    return {
        index: normalizedPrefix.length === 0 ? 0 : normalizedPrefix.length + 1,
        end: earliest.index + earliest[0].length,
    };
}
