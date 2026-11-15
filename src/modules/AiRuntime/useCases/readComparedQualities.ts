import { type AnswerInterpretationCatalog } from '../models/AnswerInterpretation';

import { maskTrackReferences } from './maskTrackReferences';

export type ComparedQuality = 'loudness' | 'brightness' | 'width' | 'dynamics';

/**
 * Every word that names a quality in any form. Punch is judged as dynamics: the authored `*-punchy` recipes
 * move `crestFactor` up, while `transientDensity` is only held in them and counts transients rather than how
 * hard they land, so crest factor is the metric that follows how hard a hit lands.
 */
const QUALITY_WORDS: Record<ComparedQuality, readonly string[]> = {
    loudness: ['loud', 'louder', 'loudness', 'quiet', 'quieter', 'soft', 'softer', 'volume', 'level'],
    brightness: ['bright', 'brighter', 'brightness', 'dark', 'darker', 'dull', 'duller'],
    width: ['wide', 'wider', 'width', 'narrow', 'narrower'],
    dynamics: ['dynamic', 'dynamics', 'punch', 'punchy', 'punchier', 'compressed'],
};

/** "as loud as possible" or "as wide as you can" names no second subject, so it is no marker. */
const SUPERLATIVE_TAIL = String.raw`(?!\s+(?:possible|(?:you|i|we|they|it|one)\s+(?:can|could|gets?|may)\b))`;

/** What puts two subjects side by side in one sentence. */
const COMPARISON_MARKERS: readonly RegExp[] = [
    /\bthan\b/,
    new RegExp(String.raw`\bas\s+\w+\s+as\b${SUPERLATIVE_TAIL}`),
    /\bcompared\s+(?:to|with)\b/,
    /\brelative\s+to\b/,
    /\b(?:versus|vs)\b/,
    /\bmatch\b/,
    /\bsame\b.*\bas\b/,
];

const SENTENCE_BREAK = /[.;!?\n]+/;

function namesQuality(sentence: string, words: readonly string[]): boolean {
    return new RegExp(String.raw`\b(?:${words.join('|')})\b`).test(sentence);
}

/**
 * The qualities a request states as a comparison between two subjects, read from its own words: a quality
 * word and a comparison marker in one sentence. A bare "louder" is no comparison, and a word inside a
 * quotation or a track name is never read. Recall outweighs precision: a false offer only adds planner text
 * and admission still needs a distinct reference subject, while a miss leaves the plan unverified. Direction
 * and subjects stay the provider's.
 */
export function readComparedQualities(
    prompt: string,
    context: AnswerInterpretationCatalog['context']
): ReadonlySet<ComparedQuality> {
    const sentences = maskTrackReferences(prompt, context, ' ').toLowerCase().split(SENTENCE_BREAK);
    const compared = new Set<ComparedQuality>();
    for (const sentence of sentences) {
        if (!COMPARISON_MARKERS.some((marker) => marker.test(sentence))) {
            continue;
        }
        for (const [quality, words] of Object.entries(QUALITY_WORDS) as Array<[ComparedQuality, readonly string[]]>) {
            if (namesQuality(sentence, words)) {
                compared.add(quality);
            }
        }
    }
    return compared;
}
