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

function namesQuality(text: string, words: readonly string[]): boolean {
    return new RegExp(String.raw`\b(?:${words.join('|')})\b`).test(text);
}

/**
 * The qualities the request names, in any form, outside track names and quotations. The provider chooses
 * whether the request compares and which subjects, and admission still requires a distinct reference scope,
 * so offering a named quality costs only planner text, which the local window check bounds. Withholding a
 * quality the request never names outside names and quotes is what keeps a name or a quotation from reading
 * as a comparison; no marker list is kept, because any phrasing can state one ("equal to", "in comparison to").
 */
export function readComparedQualities(
    prompt: string,
    context: AnswerInterpretationCatalog['context']
): ReadonlySet<ComparedQuality> {
    const text = maskTrackReferences(prompt, context, ' ').toLowerCase();
    const compared = new Set<ComparedQuality>();
    for (const [quality, words] of Object.entries(QUALITY_WORDS) as Array<[ComparedQuality, readonly string[]]>) {
        if (namesQuality(text, words)) {
            compared.add(quality);
        }
    }
    return compared;
}
