import { type AnswerInterpretationCatalog } from '../models/AnswerInterpretation';
import { scanPromptQuotedText } from '../transformers/promptParser/promptQuotedText';

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
 * Which qualities the request names, in any form. The provider chooses whether the request compares and
 * which subjects, and admission still requires a distinct reference scope, so offering a named quality costs
 * only planner text. A quality named only inside a track name or a quotation ("Louder Than Bombs") is never
 * read as the request's own, and no marker list is kept, because any phrasing can state a comparison. An
 * unclosed apostrophe ("'em", "'cause") leaves the masking unable to say what was quoted, so then every word
 * the prompt holds is the request's own. Only objectives added after main may depend on this reading.
 */
export function readComparedQualities(
    prompt: string,
    context: AnswerInterpretationCatalog['context']
): ReadonlySet<ComparedQuality> {
    const quotesUnknown = !scanPromptQuotedText(prompt).complete;
    const masked = maskTrackReferences(prompt, context, ' ').toLowerCase();
    const raw = prompt.toLowerCase();
    const named = new Set<ComparedQuality>();
    for (const [quality, words] of Object.entries(QUALITY_WORDS) as Array<[ComparedQuality, readonly string[]]>) {
        if (namesQuality(masked, words) || (quotesUnknown && namesQuality(raw, words))) {
            named.add(quality);
        }
    }
    return named;
}
