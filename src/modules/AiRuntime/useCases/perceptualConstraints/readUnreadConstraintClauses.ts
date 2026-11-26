import { type UnsupportedPerceptualConstraint } from '../../models/PerceptualConstraint';

import {
    ANY,
    ASSURED_NEGATION,
    ASSURING_LEAD,
    AVOID_VERB,
    BECOMING_VERB,
    CAUSING_VERB,
    CHANGING_VERB,
    CLAUSE_JOINING_AMPERSAND,
    CLAUSE_PUNCTUATION,
    CLAUSE_SEPARATOR,
    CLAUSE_SUBJECT,
    COMPARED_DIRECTION,
    DEGREE_WORD,
    OPENING_DEGREE_WORD,
    DETERMINER,
    FROM,
    HARD_BOUNDARY_WORD,
    holdingKeep,
    LEAVE_VERB,
    LINKING_VERB,
    LIST_JOINER,
    MASK_GLYPH,
    MIX_PRONOUN,
    MODAL_VERB_NEGATION,
    MOVE_LEAD_VERB,
    NEGATION,
    NO,
    NOT_PERMITTED,
    OBJECT_MEMBERS,
    POSSESSIVE_DETERMINER,
    PREDICATE_WORD,
    REFUSING_NOT,
    SCOPE_WORD,
    SPACED_AMPERSAND,
    STOP_VERB,
    SUBORDINATOR,
    WANT_LEAD,
    WITHOUT_WORD,
    WOULD_NOT,
} from './constraintClauseWords';
import {
    DIRECTION,
    MEASURED_NOUN,
    MEASURED_WORD,
    MOVE_WORD,
    NOUN_VERB_HEAD,
    SPLIT_VERB_HEAD_WORD,
    SPLIT_VERB_PARTICLE_WORD,
    WORD_END,
} from './constraintDirections';

/** A span of the request a constraint reader consumed, start inclusive and end exclusive. */
export type ConsumedSpan = { start: number; end: number };
/** A clause the net recorded unsupported, with the span of the request it quotes. */
export type UnreadClause = { unsupported: UnsupportedPerceptualConstraint; span: ConsumedSpan };

/** A level verb split around its object, which names a measured move as "turn up" does: "turn the vocal up". */
const SPLIT_MOVE = String.raw`${SPLIT_VERB_HEAD_WORD}\s+${OBJECT_MEMBERS}\s+${SPLIT_VERB_PARTICLE_WORD}`;
/** A clause is recorded only for a measured word a protection governs, so a request naming none reads nothing. */
const ANY_MEASURED_WORD = new RegExp(
    String.raw`${MEASURED_WORD}|${MEASURED_NOUN}|${COMPARED_DIRECTION}|${SPLIT_MOVE}${WORD_END}`,
    'iu'
);
const MEASURED_QUALITY = new RegExp(String.raw`\b(?:${MEASURED_WORD}|${SPLIT_MOVE})${WORD_END}`, 'giu');
/**
 * What a keep or leave holding what it names governs: a measured noun or a comparison it keeps ("keep
 * the drums quieter than the vocal"), never a way a quality moves.
 */
const HELD_QUALITY = new RegExp(String.raw`\b(?:${MEASURED_NOUN}${WORD_END}|${COMPARED_DIRECTION})`, 'giu');
/**
 * A linking verb governs a measured word only when that word follows it ("shouldn't be louder"); one
 * opening another verb phrase ("don't be afraid to make it wider") governs nothing measured.
 */
const LINKED_QUALITY = String.raw`${LINKING_VERB}\s+(?:${DEGREE_WORD}\s+)*${MEASURED_WORD}`;
/**
 * The verbs a negation governs a measured word through: one that moves a level, makes it become one,
 * changes into one ("the vocal never gets louder") or wants it ("I don't want it louder").
 */
const GOVERNED_VERB = String.raw`(?:${LINKED_QUALITY}|${CAUSING_VERB}|${CHANGING_VERB}|${WANT_LEAD}|${NOUN_VERB_HEAD}|${DIRECTION})`;
/**
 * A negation or modal directly before what it governs; a modal names its subject too. A third-person
 * "doesn't" opens nothing here: beside a move it describes the sound or states a purpose ("so it
 * doesn't get lost"), and the bound it states alone ("the mix doesn't get louder") a reader consumes. A
 * wish "do not" refuses is a governed verb above; one refused through "would not" opens here ("I wouldn't
 * want the drums louder in the chorus"), a bare
 * "not" refuses a direction ("just not any louder"), "make sure" makes a copula negation a request ("make
 * sure the vocal isn't louder in the chorus"), and "without" may name the subject of the move it rules
 * out ("without the mix getting louder in the chorus").
 */
const NEGATED_GOVERNOR = String.raw`(?:(?:(?<modal>${MODAL_VERB_NEGATION})|${NEGATION}|${AVOID_VERB})\s+${GOVERNED_VERB}|${WOULD_NOT}\s+${WANT_LEAD}|${REFUSING_NOT}\s+(?:${ANY}\s+)?${DIRECTION}|${ASSURING_LEAD}\s+${OBJECT_MEMBERS}\s+${ASSURED_NEGATION}|${WITHOUT_WORD}\s+${OBJECT_MEMBERS}\s+${MOVE_LEAD_VERB})`;
/**
 * What makes a clause protective of a measured quality: a negation or modal directly before a verb
 * it governs the quality through, or a direction ("mustn't get louder"); a keep-type verb continuing
 * no move, or a leave; a stop or prevent; or "no" before the measured word itself ("no louder"). A
 * keep, leave, stop or prevent a negation governs is permitted, not protective ("don't stop the mix
 * getting wider", "there's no need to leave the width alone"). A negation of
 * anything else ("don't forget to make the bass wider", "no reverb") governs no measured word, so it
 * opens nothing. A keep is read with the quality terms the kept-quality reader holds (`heldTerms`), so
 * the net and that reader agree on which keep holds ("keep the vocal bright getting louder").
 */
function buildProtectiveClause(heldTerms: string): RegExp {
    return new RegExp(
        String.raw`\b(?:${NEGATED_GOVERNOR}|${NOT_PERMITTED}(?<holding>${holdingKeep(heldTerms)}|${LEAVE_VERB})|${NOT_PERMITTED}${STOP_VERB}|${NO}\s+${MEASURED_WORD})${WORD_END}`,
        'iu'
    );
}

const PROTECTIVE_CLAUSES = new Map<string, RegExp>();

/** The protective pattern for one set of held terms, built once. It is never stateful: it is only `exec`ed unanchored and non-global. */
function protectiveClause(heldTerms: string): RegExp {
    const built = PROTECTIVE_CLAUSES.get(heldTerms) ?? buildProtectiveClause(heldTerms);
    PROTECTIVE_CLAUSES.set(heldTerms, built);
    return built;
}
/**
 * A keep naming the move it prevents ("keep the mix from getting louder", "from going brighter", "from
 * sounding wider", "from widening") bounds that move, so it governs ways a quality moves as a negation
 * does rather than holding what it names.
 */
const PREVENTED_MOVE = new RegExp(
    String.raw`\b${FROM}\s+(?:(?:${CAUSING_VERB}|${MOVE_LEAD_VERB})\s+)?(?:${DEGREE_WORD}\s+)?${MOVE_WORD}`,
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
const COMPARISON = new RegExp(String.raw`\b${COMPARED_DIRECTION}`, 'iu');
/**
 * Hard clause boundaries, a separator among them ("don't make it harsh - brighten the vocal"); an "and",
 * an ampersand writing one, or an "or" is a boundary whose next clause may share a protection. A comma
 * right before the "and" or "or" is part of that one joiner, as it is in every list ("don't make the drums
 * wider, and the mix louder in the chorus"), so it never ends the protection before the joiner continues it.
 * The joiner is tried first, so the comma is never read as a boundary of its own.
 */
const BOUNDARY = new RegExp(
    String.raw`(?<joiner>(?:,\s*)?\b${LIST_JOINER}\b|${CLAUSE_JOINING_AMPERSAND}|${SPACED_AMPERSAND})|${CLAUSE_PUNCTUATION}|(?<separator>${CLAUSE_SEPARATOR})|\b${HARD_BOUNDARY_WORD}\b`,
    'giu'
);
/** The words a joined clause may open with and still continue the protection before it. */
const CONTINUES = new RegExp(
    String.raw`^\s*(?:(?:${DETERMINER}|${POSSESSIVE_DETERMINER}|${MIX_PRONOUN}|${OPENING_DEGREE_WORD})${WORD_END}|${MASK_GLYPH}|${SCOPE_WORD}\b|${DIRECTION})`,
    'iu'
);
/**
 * The words a segment after a separator or joiner opens with when it is the rest of the protection before it,
 * which named its object and nothing it governs: a prevented move ("keep Keys - from getting wider"), a
 * becoming or linking verb ("don't let Keys - get louder") or a comparative ("don't make Keys - louder").
 * A verb of its own ("don't make it harsh - brighten the vocal") opens a clause of its own.
 */
const DANGLING_REST = new RegExp(
    String.raw`^\s*(?:${FROM}|${BECOMING_VERB}|${LINKING_VERB}|(?:${OPENING_DEGREE_WORD}\s+)?${DIRECTION})${WORD_END}`,
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

/** A segment between boundaries: whether a joining word or a separator opens it. */
type Segment = { start: number; end: number; joined: boolean; separated: boolean };

function segmentsOf(masked: string): Segment[] {
    const segments: Segment[] = [];
    let start = 0;
    let joined = false;
    let separated = false;
    for (const boundary of masked.matchAll(BOUNDARY)) {
        segments.push({ start, end: boundary.index, joined, separated });
        start = boundary.index + boundary[0].length;
        joined = boundary.groups?.joiner !== undefined;
        separated = boundary.groups?.separator !== undefined;
    }
    segments.push({ start, end: masked.length, joined, separated });
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

/** The masked request the net reads, the spans its readers consumed and what makes a clause protective. */
type NetRequest = { masked: string; consumed: readonly ConsumedSpan[]; protective: RegExp };

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
function readProtection(segment: Segment, text: string, protective: RegExp): Governed | null {
    const protection = protective.exec(text);
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

/**
 * A joined segment may continue an open chain, and a separated or joined one the rest of a protection
 * that governed nothing before the separator or joiner ("keep Keys & from getting wider"); any other
 * opens a chain only if it protects.
 */
function chainStep(segment: Segment, chain: Chain | null, request: NetRequest): ChainStep | null {
    const text = request.masked.slice(segment.start, segment.end);
    const end = segment.start + governedEnd(text, 0);
    if (chain?.continuable === true && segment.joined && continuesChain(text)) {
        return { chain, governed: { start: segment.start, end, holds: chain.holds } };
    }
    if (chain !== null && !chain.continuable && (segment.separated || segment.joined) && DANGLING_REST.test(text)) {
        const governed = { start: segment.start, end, holds: false };
        return { chain: { ...chain, holds: false, continuable: true }, governed };
    }
    const governed = readProtection(segment, text, request.protective);
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
 * the masked request, so a track name or a quotation never opens or fills one. Each entry carries the
 * span it quotes. `heldTerms` is the pattern of quality terms the kept-quality reader holds.
 */
export function readUnreadConstraintClauses(
    masked: string,
    prompt: string,
    consumed: readonly ConsumedSpan[],
    heldTerms: string
): UnreadClause[] {
    if (!ANY_MEASURED_WORD.test(masked)) {
        return [];
    }
    const unread: (UnsupportedPerceptualConstraint & ConsumedSpan)[] = [];
    const request: NetRequest = { masked, consumed, protective: protectiveClause(heldTerms) };
    let chain: Chain | null = null;
    for (const segment of segmentsOf(masked)) {
        const step = chainStep(segment, chain, request);
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
        unread.push({ start, end: segment.end, ...unreadClause(masked, prompt, start, segment.end) });
    }
    return unread.map(({ constraintId, clause, reason, start, end }) => ({
        unsupported: { constraintId, clause, reason },
        span: { start, end },
    }));
}
