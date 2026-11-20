import { type UnsupportedPerceptualConstraint } from '../../models/PerceptualConstraint';

import { MODAL_NEGATION, NEGATION, QUALITY_VERBS, SCOPE_WORD } from './constraintClauseWords';
import { DIRECTION } from './constraintDirections';

/** A span of the request a constraint reader consumed, start inclusive and end exclusive. */
export type ConsumedSpan = { start: number; end: number };

/**
 * A word naming a quality a measured constraint holds or a way it moves. Plain adjectives ("bright",
 * "wide") are left out: a quality reader reads those, and elsewhere they mostly describe a sound.
 */
const MEASURED_WORD = String.raw`(?:levels?|loudness|volume|width|stereo\s+(?:image|field|spread)|brightness|dynamics|dynamic\s+range|widen(?:ing)?|narrow(?:ing)?|brighten(?:ing)?|darken(?:ing)?|squash(?:ing)?|flatten(?:ing)?|${DIRECTION})`;
const MEASURED_QUALITY = new RegExp(String.raw`\b${MEASURED_WORD}(?![\p{L}\p{N}])`, 'giu');
/**
 * A linking verb governs a measured word only when that word follows it ("shouldn't be louder"); one
 * opening another verb phrase ("don't be afraid to make it wider") governs nothing measured.
 */
const LINKING_VERB = String.raw`(?:be|sound|feel|seem)\s+(?:(?:any|more|less|too|so)\s+)?${MEASURED_WORD}`;
/** The verbs a negation governs a measured word through: one that moves a level or makes it become one. */
const GOVERNED_VERB = String.raw`(?:${LINKING_VERB}|make|making|get|getting|let|letting|become|becoming|raise|raising|increase|increasing|boost|boosting|push|pushing|turn|turning|lower|lowering|reduce|reducing|decrease|decreasing|change|changing|alter|altering|touch|touching|widen(?:ing)?|narrow(?:ing)?|brighten(?:ing)?|darken(?:ing)?|squash(?:ing)?|flatten(?:ing)?)`;
/**
 * What makes a clause protective of a measured quality: a negation or modal directly before a verb
 * it governs the quality through, or a direction ("isn't louder"); a keep-type verb; or "no" before
 * the measured word itself ("no louder"). A negation of anything else ("don't forget to make the bass
 * wider", "no reverb") governs no measured word, so it opens nothing.
 */
const PROTECTIVE = new RegExp(
    String.raw`\b(?:(?:${NEGATION}|${MODAL_NEGATION}|avoid|avoiding)\s+(?:${GOVERNED_VERB}|${DIRECTION})|${QUALITY_VERBS}|leave|leaving|stop|stopping|prevent|preventing|no\s+${MEASURED_WORD})(?![\p{L}\p{N}])`,
    'iu'
);
const COMPARISON = new RegExp(String.raw`\b${DIRECTION}\s+than\b`, 'iu');
/** Hard clause boundaries; an "and" or "or" is a boundary whose next clause may share a protection. */
const BOUNDARY = /[,.;:!?]|\b(?:but|while|so|then|please)\b|\b(?<joiner>and|or)\b/giu;
/** The words a joined clause may open with and still continue the protection before it. */
const CONTINUES = new RegExp(
    String.raw`^\s*(?:the|my|our|this|that|its|their|it|everything|anything|any|more|less|□|(?:${SCOPE_WORD})\b|${DIRECTION})`,
    'iu'
);

export const COMPARATIVE_REASON =
    'It compares against another track or the mix, and a measured bound holds one scope only to its own figures.';
export const UNREAD_REASON =
    'The application reads no measured bound or hold in these words, so nothing it measures shows that they hold.';

type Segment = { start: number; end: number; joined: boolean };

function segmentsOf(masked: string): Segment[] {
    const segments: Segment[] = [];
    let start = 0;
    let joined = false;
    for (const boundary of masked.matchAll(BOUNDARY)) {
        segments.push({ start, end: boundary.index, joined });
        start = boundary.index + boundary[0].length;
        joined = boundary.groups?.joiner !== undefined;
    }
    segments.push({ start, end: masked.length, joined });
    return segments;
}

function isConsumed(index: number, consumed: readonly ConsumedSpan[]): boolean {
    return consumed.some((span) => span.start <= index && index < span.end);
}

function unreadClause(masked: string, prompt: string, start: number, end: number): UnsupportedPerceptualConstraint {
    const reason = COMPARISON.test(masked.slice(start, end)) ? COMPARATIVE_REASON : UNREAD_REASON;
    return { constraintId: 'unsupported', clause: prompt.slice(start, end).trim(), reason };
}

/**
 * The never-dropped net. A protective clause, or one an "and" or "or" joins to it ("don't make the mix
 * louder and the vocal much quieter"), that names a measured quality no reader consumed is recorded
 * unsupported with its words, so no protective clause the readers miss is silently dropped. It reads
 * the masked request, so a track name or a quotation never opens or fills one.
 */
export function readUnreadConstraintClauses(
    masked: string,
    prompt: string,
    consumed: readonly ConsumedSpan[]
): UnsupportedPerceptualConstraint[] {
    const unread: (UnsupportedPerceptualConstraint & { start: number })[] = [];
    let chainStart: number | null = null;
    for (const segment of segmentsOf(masked)) {
        const text = masked.slice(segment.start, segment.end);
        const continues = segment.joined && chainStart !== null && CONTINUES.test(text);
        if (PROTECTIVE.test(text) && !continues) {
            chainStart = segment.start;
        } else if (!continues) {
            chainStart = null;
        }
        if (chainStart === null) {
            continue;
        }
        const missed = Array.from(text.matchAll(MEASURED_QUALITY)).some(
            (word) => !isConsumed(segment.start + word.index, consumed)
        );
        if (!missed) {
            continue;
        }
        // A chain is one clause: a later missed segment of it widens the entry rather than adding one.
        if (unread.at(-1)?.start === chainStart) {
            unread.pop();
        }
        unread.push({ start: chainStart, ...unreadClause(masked, prompt, chainStart, segment.end) });
    }
    return unread.map(({ constraintId, clause, reason }) => ({ constraintId, clause, reason }));
}
