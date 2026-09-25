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

/** Proposed names come from provider calls, so compiled patterns are bounded; the oldest leaves first. */
const COMPILED_PATTERN_CAPACITY = 1024;

/** Compiling a Unicode property class costs far more than matching it, so each source compiles once. */
const compiledPatterns = new Map<string, RegExp>();

/** Each registry phrase's splits; registry phrases bound their number. */
const phraseSplits = new Map<string, readonly PhraseSplit[]>();

type PhraseSplit = {
    head: string;
    tail: string;
    headWords: readonly RegExp[];
    tailWords: readonly RegExp[];
};

type GapPattern = {
    source: string;
    /** The literal words the gap holds, in order. */
    words: readonly RegExp[];
};

function getCompiledPattern(source: string): RegExp {
    const cached = compiledPatterns.get(source);
    if (cached) {
        return cached;
    }
    const pattern = new RegExp(source, 'iu');
    while (compiledPatterns.size >= COMPILED_PATTERN_CAPACITY) {
        const oldest = compiledPatterns.keys().next().value;
        if (oldest === undefined) {
            break;
        }
        compiledPatterns.delete(oldest);
    }
    compiledPatterns.set(source, pattern);
    return pattern;
}

function getWordPatterns(words: readonly string[]): RegExp[] {
    return words.map((word) => getCompiledPattern(escapeRegExp(word)));
}

function getWordsPattern(words: readonly string[]): string {
    return words.map((word) => escapeRegExp(word)).join(GAP_SEPARATOR);
}

function getPhraseSplits(intentPhrase: string): readonly PhraseSplit[] {
    const cached = phraseSplits.get(intentPhrase);
    if (cached) {
        return cached;
    }
    const words = normalizePromptText(intentPhrase).split(' ').filter(Boolean);
    const splits = words.slice(1).map((_, index) => {
        const headWords = words.slice(0, index + 1);
        const tailWords = words.slice(index + 1);
        return {
            head: getWordsPattern(headWords),
            tail: getWordsPattern(tailWords),
            headWords: getWordPatterns(headWords),
            tailWords: getWordPatterns(tailWords),
        };
    });
    phraseSplits.set(intentPhrase, splits);
    return splits;
}

const MASKED_REFERENCE_GAP_PATTERN: GapPattern = {
    source: MASKED_REFERENCE_GAP,
    words: getWordPatterns(['□']),
};

function getProposedNameGap(name: string): GapPattern | null {
    const words = normalizePromptText(name).split(' ').filter(Boolean);
    if (words.length === 0) {
        return null;
    }
    return {
        source: `${GAP_SEPARATOR}${words.map((word) => escapeRegExp(word)).join('[^\\p{L}\\p{N}]+')}${GAP_SEPARATOR}`,
        words: getWordPatterns(words),
    };
}

/** A gapped pattern holds its literal words in this order, so a clause without them in order cannot match it. */
function holdsWordsInOrder(text: string, words: readonly RegExp[]): boolean {
    let from = 0;
    for (const word of words) {
        const match = word.exec(text.slice(from));
        if (!match) {
            return false;
        }
        from += match.index + match[0].length;
    }
    return true;
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
    const gapPatterns = gaps.proposedNames.flatMap((name) => getProposedNameGap(name) ?? []);
    if (gaps.maskedReference && text.includes('□')) {
        gapPatterns.unshift(MASKED_REFERENCE_GAP_PATTERN);
    }
    if (gapPatterns.length === 0) {
        return null;
    }
    let earliest: RegExpExecArray | null = null;
    for (const split of getPhraseSplits(intentPhrase)) {
        for (const gap of gapPatterns) {
            if (!holdsWordsInOrder(text, [...split.headWords, ...gap.words, ...split.tailWords])) {
                continue;
            }
            const source = `(?<![\\p{L}\\p{N}])${split.head}${gap.source}${split.tail}(?![\\p{L}\\p{N}])`;
            const match = getCompiledPattern(source).exec(text);
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
