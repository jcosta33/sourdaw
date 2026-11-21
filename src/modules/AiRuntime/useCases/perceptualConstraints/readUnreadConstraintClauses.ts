import { type UnsupportedPerceptualConstraint } from '../../models/PerceptualConstraint';

import {
    AVOID_VERB,
    CAUSING_VERB,
    CLAUSE_PUNCTUATION,
    CLAUSE_SUBJECT,
    DEGREE_WORD,
    DETERMINER,
    FROM,
    HARD_BOUNDARY_WORD,
    HOLDING_KEEP,
    LEAVE_VERB,
    LINKING_VERB,
    LIST_JOINER,
    MASK_GLYPH,
    MIX_PRONOUN,
    MODAL_NEGATION,
    MODAL_VERB_NEGATION,
    NEGATION,
    NO,
    OBJECT_MEMBERS,
    POSSESSIVE_DETERMINER,
    PREDICATE_WORD,
    SCOPE_WORD,
    STOP_VERB,
    SUBORDINATOR,
} from './constraintClauseWords';
import { DIRECTION, MEASURED_NOUN, MEASURED_WORD, MOVE_WORD, NOUN_VERB_HEAD, WORD_END } from './constraintDirections';

/** A span of the request a constraint reader consumed, start inclusive and end exclusive. */
export type ConsumedSpan = { start: number; end: number };

const MEASURED_QUALITY = new RegExp(String.raw`\b${MEASURED_WORD}${WORD_END}`, 'giu');
/**
 * What a keep or leave holding what it names governs: a measured noun or a comparison it keeps ("keep
 * the drums quieter than the vocal"), never a way a quality moves.
 */
const HELD_QUALITY = new RegExp(String.raw`\b(?:${MEASURED_NOUN}${WORD_END}|${DIRECTION}\s+than\b)`, 'giu');
/**
 * A linking verb governs a measured word only when that word follows it ("shouldn't be louder"); one
 * opening another verb phrase ("don't be afraid to make it wider") governs nothing measured.
 */
const LINKED_QUALITY = String.raw`${LINKING_VERB}\s+(?:${DEGREE_WORD}\s+)?${MEASURED_WORD}`;
/** The verbs a negation governs a measured word through: one that moves a level or makes it become one. */
const GOVERNED_VERB = String.raw`(?:${LINKED_QUALITY}|${CAUSING_VERB}|${NOUN_VERB_HEAD}|${DIRECTION})`;
/**
 * A negation or modal directly before what it governs; a modal names its subject too. A third-person
 * "doesn't" opens nothing here: beside a move it describes the sound or states a purpose ("so it
 * doesn't get lost"), and the bound it states alone ("the mix doesn't get louder") a reader consumes.
 */
const NEGATED_GOVERNOR = String.raw`(?:(?<modal>${MODAL_VERB_NEGATION})|${NEGATION}|${AVOID_VERB})\s+${GOVERNED_VERB}`;
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
    String.raw`\b(?:${NEGATED_GOVERNOR}|(?<holding>${HOLDING_KEEP}|${LEAVE_VERB})|${NOT_NEGATED}${STOP_VERB}|${NO}\s+${MEASURED_WORD})${WORD_END}`,
    'iu'
);
/**
 * A keep naming the move it prevents ("keep the mix from getting louder", "from widening") bounds that
 * move, so it governs ways a quality moves as a negation does rather than holding what it names.
 */
const PREVENTED_MOVE = new RegExp(
    String.raw`\b${FROM}\s+(?:${CAUSING_VERB}\s+)?(?:${DEGREE_WORD}\s+)?${MOVE_WORD}`,
    'iu'
);
/**
 * Where a protection's governed words end: the first subordinator or subject pronoun after it, whatever
 * verb follows, since a subject pronoun in a protection's own complement is taken to open a clause of
 * its own. Past it stand the request's own move or condition ("prevent clipping when I make the vocal
 * louder"), while a prevented move named in the protection's own complement ("stop the drums from
 * getting wider") sits before it.
 */
const GOVERNED_END = new RegExp(String.raw`\b(?:${SUBORDINATOR}|${CLAUSE_SUBJECT})${WORD_END}`, 'iu');
const COMPARISON = new RegExp(String.raw`\b${DIRECTION}\s+than\b`, 'iu');
/** Hard clause boundaries; an "and" or "or" is a boundary whose next clause may share a protection. */
const BOUNDARY = new RegExp(
    String.raw`${CLAUSE_PUNCTUATION}|\b${HARD_BOUNDARY_WORD}\b|\b(?<joiner>${LIST_JOINER})\b`,
    'giu'
);
/** The words a joined clause may open with and still continue the protection before it. */
const CONTINUES = new RegExp(
    String.raw`^\s*(?:(?:${DETERMINER}|${POSSESSIVE_DETERMINER}|${MIX_PRONOUN}|${DEGREE_WORD})${WORD_END}|${MASK_GLYPH}|${SCOPE_WORD}\b|${DIRECTION})`,
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
 * The words a segment's protection governs, as offsets into the masked request, and whether the
 * protection is a keep or leave holding what it names rather than a negation bounding a move.
 */
type Governed = { start: number; end: number; holds: boolean };

/**
 * A protection chain: where it starts, whether it holds what it names, and whether a joined segment
 * may continue it, which only an opening that governed a measured word or a reader's clause allows,
 * so "without making it harsh and the drums louder" continues nothing.
 */
type Chain = { start: number; holds: boolean; continuable: boolean };

type ChainStep = { chain: Chain; governed: Governed };

/** The masked request the net reads and the spans its readers consumed. */
type NetRequest = { masked: string; consumed: readonly ConsumedSpan[] };

function governedEnd(text: string, from: number): number {
    const end = GOVERNED_END.exec(text.slice(from));
    return end === null ? text.length : from + end.index;
}

/**
 * What a segment's protection governs, or null for a segment that protects nothing: from the
 * protective word, or from the clause's head for a modal negation whose subject is all that stands
 * before it, to the governed end. A measured word stated before an unrelated protection ("brighten the
 * vocal without making it harsh") is the request, never a protected quality.
 */
function readProtection(segment: Segment, text: string): Governed | null {
    const protection = PROTECTIVE.exec(text);
    if (protection === null) {
        return null;
    }
    const modalSubject = protection.groups?.modal !== undefined && SUBJECT_ONLY.test(text.slice(0, protection.index));
    const start = modalSubject ? 0 : protection.index;
    const end = governedEnd(text, protection.index + protection[0].length);
    const holds = protection.groups?.holding !== undefined && !PREVENTED_MOVE.test(text.slice(protection.index, end));
    return { start: segment.start + start, end: segment.start + end, holds };
}

/** Where the measured words a span governs stand; a hold governs what it names, never a move a joined clause asks for. */
function governedWords(masked: string, governed: Governed): number[] {
    const pattern = governed.holds ? HELD_QUALITY : MEASURED_QUALITY;
    return Array.from(
        masked.slice(governed.start, governed.end).matchAll(pattern),
        (word) => governed.start + word.index
    );
}

function overlapsConsumed(governed: Governed, consumed: readonly ConsumedSpan[]): boolean {
    return consumed.some((span) => span.start < governed.end && governed.start < span.end);
}

/** A joined segment may continue an open chain; any other opens a chain only if it protects. */
function chainStep(segment: Segment, chain: Chain | null, request: NetRequest): ChainStep | null {
    const text = request.masked.slice(segment.start, segment.end);
    if (chain?.continuable === true && segment.joined && continuesChain(text)) {
        const governed = { start: segment.start, end: segment.start + governedEnd(text, 0), holds: chain.holds };
        return { chain, governed };
    }
    const governed = readProtection(segment, text);
    if (governed === null) {
        return null;
    }
    const continuable =
        governedWords(request.masked, governed).length > 0 || overlapsConsumed(governed, request.consumed);
    return { chain: { start: segment.start, holds: governed.holds, continuable }, governed };
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
    let chain: Chain | null = null;
    for (const segment of segmentsOf(masked)) {
        const step = chainStep(segment, chain, { masked, consumed });
        chain = step?.chain ?? null;
        if (step === null) {
            continue;
        }
        const missed = governedWords(masked, step.governed).some((index) => !isConsumed(index, consumed));
        if (!missed) {
            continue;
        }
        // A chain is one clause: a later missed segment of it widens the entry rather than adding one.
        const { start } = step.chain;
        if (unread.at(-1)?.start === start) {
            unread.pop();
        }
        unread.push({ start, ...unreadClause(masked, prompt, start, segment.end) });
    }
    return unread.map(({ constraintId, clause, reason }) => ({ constraintId, clause, reason }));
}
