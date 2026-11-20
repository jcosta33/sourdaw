import { type PromptNumber } from './classifyPromptDecibelFigures';
import { normalizePromptText } from './normalizePromptText';

const ROW_NOUNS: readonly string[] = ['row', 'rows', 'track', 'tracks', 'height', 'heights'];
const GROWING_COMPARATIVES: readonly string[] = ['taller', 'bigger', 'larger'];
const SHRINKING_COMPARATIVES: readonly string[] = ['shorter', 'smaller'];
const GROWING_VERBS: readonly string[] = ['grow', 'enlarge', 'increase', 'raise'];
const SHRINKING_VERBS: readonly string[] = ['shrink', 'reduce', 'decrease', 'lower'];
const ZOOM_OBJECT_WORDS: readonly string[] = ['tracks', 'track', 'vertically', 'vertical'];
/** Words that may follow the zoom's own particle: "out by 40", "in 40", "out" ending the clause. */
const PARTICLE_FOLLOWERS: readonly string[] = ['by', 'to'];
const COMPARATIVE_REACH = 5;
const VERB_REACH = 4;

function namesRowWithin(words: readonly string[], from: number, to: number): boolean {
    return words.slice(Math.max(from, 0), to).some((word) => ROW_NOUNS.includes(word));
}

/** A comparative describes the rows when a row or track noun sits within a few words either side. */
function describesRows(words: readonly string[], index: number): boolean {
    return namesRowWithin(words, index - COMPARATIVE_REACH, index + COMPARATIVE_REACH + 1);
}

/** A verb acts on the rows when its object, a row or track noun, follows within a few words. */
function actsOnRows(words: readonly string[], index: number): boolean {
    return namesRowWithin(words, index + 1, index + VERB_REACH + 1);
}

function isNumberWord(word: string | undefined): boolean {
    return word !== undefined && /^[+-]?\d/u.test(word);
}

/** The zoom's own particle: "zoom out", "zoom tracks vertically in by 40", never "in the chorus". */
function readZoomParticle(words: readonly string[]): 'in' | 'out' | null {
    const zoomIndex = words.indexOf('zoom');
    if (zoomIndex < 0) {
        return null;
    }
    let particleIndex = zoomIndex + 1;
    while (ZOOM_OBJECT_WORDS.includes(words[particleIndex] ?? '')) {
        particleIndex += 1;
    }
    const particle = words[particleIndex];
    if (particle !== 'in' && particle !== 'out') {
        return null;
    }
    const follower = words[particleIndex + 1];
    const endsParticle = follower === undefined || PARTICLE_FOLLOWERS.includes(follower) || isNumberWord(follower);
    return endsParticle ? particle : null;
}

function readsGrowing(words: readonly string[]): boolean {
    return (
        readZoomParticle(words) === 'in' ||
        words.some(
            (word, index) =>
                (GROWING_COMPARATIVES.includes(word) && describesRows(words, index)) ||
                (GROWING_VERBS.includes(word) && actsOnRows(words, index))
        )
    );
}

function readsShrinking(words: readonly string[]): boolean {
    return (
        readZoomParticle(words) === 'out' ||
        words.some(
            (word, index) =>
                (SHRINKING_COMPARATIVES.includes(word) && describesRows(words, index)) ||
                (SHRINKING_VERBS.includes(word) && actsOnRows(words, index))
        )
    );
}

/**
 * A row-height change is signed by words that describe the zoom or the rows: the zoom's own `in`
 * or `out`, a comparative (taller, shorter, bigger, smaller, larger) beside a row or track noun, or a
 * verb (grow, shrink, increase, reduce, decrease, lower, raise) acting on one. `up` and `down` say
 * nothing about rows, and `in` or `out` elsewhere ("in the chorus") is no direction. A figure the
 * request signs itself keeps that sign and a request naming neither way keeps the figure as stated.
 * A request naming both ways says no sign, so no sign grounds (NaN matches no asserted delta).
 */
export function applyVerticalZoomDirection(value: number, number: PromptNumber, maskedScope: string): number {
    if (/^[+-]/u.test(number.raw)) {
        return value;
    }
    const words = normalizePromptText(maskedScope).split(' ');
    const grows = readsGrowing(words);
    const shrinks = readsShrinking(words);
    if (grows && shrinks) {
        return Number.NaN;
    }
    if (!grows && !shrinks) {
        return value;
    }
    return grows ? Math.abs(value) : -Math.abs(value);
}
