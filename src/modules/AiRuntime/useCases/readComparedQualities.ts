import { type AnswerInterpretationCatalog } from '../models/AnswerInterpretation';

import { maskTrackReferences } from './maskTrackReferences';

export type ComparedQuality = 'loudness' | 'brightness' | 'width' | 'dynamics';

const THAN = String.raw`\bthan\b`;
const LESS_OR_MORE = String.raw`(?:more|less)`;

/**
 * Punch is judged as dynamics: the authored `*-punchy` recipes move `crestFactor` up, while `transientDensity`
 * only counts transients and is held in them, so crest factor is the metric that follows how hard a hit lands.
 */
const COMPARISON_FORMS: ReadonlyArray<readonly [ComparedQuality, RegExp]> = [
    ['loudness', new RegExp(String.raw`\b(?:louder|quieter|softer)\s+${THAN}`)],
    ['loudness', new RegExp(String.raw`\b${LESS_OR_MORE}\s+(?:loud|quiet)\s+${THAN}`)],
    ['loudness', /\bas\s+(?:loud|quiet|soft)\s+as\b/],
    ['loudness', /\bmatch\b[^.;!?]*\b(?:loudness|level)\b/],
    ['loudness', /\bsame\s+(?:loudness|level)\b/],
    ['brightness', new RegExp(String.raw`\b(?:brighter|darker|duller)\s+${THAN}`)],
    ['brightness', new RegExp(String.raw`\b${LESS_OR_MORE}\s+(?:bright|dark|dull)\s+${THAN}`)],
    ['brightness', /\bas\s+(?:bright|dark|dull)\s+as\b/],
    ['width', new RegExp(String.raw`\b(?:wider|narrower)\s+${THAN}`)],
    ['width', new RegExp(String.raw`\b${LESS_OR_MORE}\s+(?:wide|narrow)\s+${THAN}`)],
    ['width', /\bas\s+(?:wide|narrow)\s+as\b/],
    ['dynamics', new RegExp(String.raw`\bpunchier\s+${THAN}`)],
    ['dynamics', new RegExp(String.raw`\b${LESS_OR_MORE}\s+(?:punch|punchy|dynamic|dynamics|compressed)\s+${THAN}`)],
    ['dynamics', /\bas\s+(?:punchy|dynamic|compressed)\s+as\b/],
];

/**
 * The qualities a request states as a comparison between two subjects, read from its own words: a
 * comparative with "than", "as ... as", or "match ... loudness". A bare "louder" is no comparison, and
 * a word inside a quotation or a track name is never read. Direction and subjects stay the provider's.
 */
export function readComparedQualities(
    prompt: string,
    context: AnswerInterpretationCatalog['context']
): ReadonlySet<ComparedQuality> {
    const text = maskTrackReferences(prompt, context, ' ').toLowerCase();
    return new Set(COMPARISON_FORMS.filter(([, form]) => form.test(text)).map(([quality]) => quality));
}
