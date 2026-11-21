import { type UnsupportedPerceptualConstraint } from '../../models/PerceptualConstraint';

import {
    CAUSING_VERB,
    DEGREE_WORD,
    DETERMINER,
    HARD_BOUNDARY_WORD,
    HOLDING_KEEP,
    LEAVE_VERB,
    LINKING_VERB,
    LIST_JOINER,
    MIX_PRONOUN,
    MODAL_NEGATION,
    NEGATION,
    OBJECT_MEMBERS,
    POSSESSIVE_DETERMINER,
    PREDICATE_WORD,
    SCOPE_WORD,
    STOP_VERB,
} from './constraintClauseWords';
import { DIRECTION, MEASURED_WORD, NOUN_VERB_HEAD } from './constraintDirections';

/** A span of the request a constraint reader consumed, start inclusive and end exclusive. */
export type ConsumedSpan = { start: number; end: number };

const WORD_END = String.raw`(?![\p{L}\p{N}])`;
const MEASURED_QUALITY = new RegExp(String.raw`\b${MEASURED_WORD}${WORD_END}`, 'giu');
/**
 * A linking verb governs a measured word only when that word follows it ("shouldn't be louder"); one
 * opening another verb phrase ("don't be afraid to make it wider") governs nothing measured.
 */
const LINKED_QUALITY = String.raw`${LINKING_VERB}\s+(?:${DEGREE_WORD}\s+)?${MEASURED_WORD}`;
/** The verbs a negation governs a measured word through: one that moves a level or makes it become one. */
const GOVERNED_VERB = String.raw`(?:${LINKED_QUALITY}|${CAUSING_VERB}|${NOUN_VERB_HEAD}|${DIRECTION})`;
/** A negation or modal directly before what it governs; a modal names its subject too. */
const NEGATED_GOVERNOR = String.raw`(?:(?<modal>${MODAL_NEGATION})|${NEGATION}|avoid|avoiding)\s+${GOVERNED_VERB}`;
/** A negated stop or prevent permits what it governs: "don't stop the mix getting wider". */
const NOT_NEGATED = String.raw`(?<!(?:${NEGATION}|${MODAL_NEGATION})\s+)`;
/**
 * What makes a clause protective of a measured quality: a negation or modal directly before a verb
 * it governs the quality through, or a direction ("mustn't get louder"); a keep-type verb continuing
 * no move; a leave; a stop or prevent no negation permits; or "no" before the measured word itself
 * ("no louder"). A negation of anything else ("don't forget to make the bass wider", "no reverb")
 * governs no measured word, so it opens nothing.
 */
const PROTECTIVE = new RegExp(
    String.raw`\b(?:${NEGATED_GOVERNOR}|${HOLDING_KEEP}|${LEAVE_VERB}|${NOT_NEGATED}${STOP_VERB}|no\s+${MEASURED_WORD})${WORD_END}`,
    'iu'
);
const COMPARISON = new RegExp(String.raw`\b${DIRECTION}\s+than\b`, 'iu');
/** Hard clause boundaries; an "and" or "or" is a boundary whose next clause may share a protection. */
const BOUNDARY = new RegExp(String.raw`[,.;:!?]|\b${HARD_BOUNDARY_WORD}\b|\b(?<joiner>${LIST_JOINER})\b`, 'giu');
/** The words a joined clause may open with and still continue the protection before it. */
const CONTINUES = new RegExp(
    String.raw`^\s*(?:(?:${DETERMINER}|${POSSESSIVE_DETERMINER}|${MIX_PRONOUN}|${DEGREE_WORD})${WORD_END}|□|${SCOPE_WORD}\b|${DIRECTION})`,
    'iu'
);
/** A joined clause whose object takes a verb of its own states its own clause: "and the vocal needs …". */
const OWN_PREDICATE = new RegExp(String.raw`^\s*${OBJECT_MEMBERS}\s+${PREDICATE_WORD}${WORD_END}`, 'iu');
/** A clause whose only words before a modal negation are its subject: "the vocal level shouldn't change". */
const SUBJECT_ONLY = new RegExp(String.raw`^\s*${OBJECT_MEMBERS}\s*$`, 'iu');

const COMPARATIVE_REASON =
    'It compares against another track or the mix, and a measured bound holds one scope only to its own figures.';
const UNREAD_REASON =
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

function continuesChain(text: string): boolean {
    return CONTINUES.test(text) && !OWN_PREDICATE.test(text);
}

/**
 * Where the words a clause's protection governs begin, or null for a clause that protects nothing:
 * from the protective word onward, or from the clause's head for a modal negation whose subject is
 * all that stands before it. A measured word stated before an unrelated protection ("brighten the
 * vocal without making it harsh") is the request, never a protected quality.
 */
function governedStart(text: string): number | null {
    const protection = PROTECTIVE.exec(text);
    if (protection === null) {
        return null;
    }
    const modalSubject = protection.groups?.modal !== undefined && SUBJECT_ONLY.test(text.slice(0, protection.index));
    return modalSubject ? 0 : protection.index;
}

/** Where the protection chain starts after a segment, and where the segment's governed words begin. */
type ChainStep = { chainStart: number | null; governed: number | null };

/** A joined segment continuing the chain is governed whole; any other opens a chain only if it protects. */
function chainStep(segment: Segment, text: string, chainStart: number | null): ChainStep {
    if (segment.joined && chainStart !== null && continuesChain(text)) {
        return { chainStart, governed: 0 };
    }
    const governed = governedStart(text);
    return { chainStart: governed === null ? null : segment.start, governed };
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
        const step = chainStep(segment, text, chainStart);
        chainStart = step.chainStart;
        const { governed } = step;
        if (chainStart === null || governed === null) {
            continue;
        }
        const offset = segment.start + governed;
        const missed = Array.from(text.slice(governed).matchAll(MEASURED_QUALITY)).some(
            (word) => !isConsumed(offset + word.index, consumed)
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
