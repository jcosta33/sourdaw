import { refinementProtectionForms } from './refinementProtectionForms';

/** Where an explicit protection clause sits in a request: the references it protects and how it was closed. */

const PROTECTION_VERB = String.raw`(?:leave|leaving|keep|keeping|preserve|preserving|retain|retaining)`;
const INSTRUCTION_VERBS = String.raw`(?:turn|set|make|raise|lower|boost|cut|reduce|increase|decrease|add|create|remove|delete|rename|insert|copy|duplicate|trim|split|quantize|transpose|normalize|bring|apply|load|import|export|bounce|render)`;

const startPatterns: ReadonlyArray<{ kind: StartKind; pattern: RegExp }> = [
    { kind: 'verb', pattern: new RegExp(String.raw`\b${PROTECTION_VERB}\b`, 'giu') },
    {
        kind: 'prohibition',
        pattern: /\b(?:do\s+not|don['’]t|never)\s+(?:change|touch|alter|adjust|modify|edit|affect|move)\b/giu,
    },
    { kind: 'prohibition', pattern: /\bwithout\s+(?:touching|changing|altering|moving|editing)\b/giu },
    { kind: 'prohibition', pattern: /\bno\s+changes?\s+to\b/giu },
    {
        kind: 'carve-out',
        pattern: /\b(?:except(?:\s+for)?|excluding|but\s+not|apart\s+from|other\s+than|besides)\b/giu,
    },
];
const instructionPattern = new RegExp(String.raw`\b${INSTRUCTION_VERBS}\b`, 'giu');
const conjunctionPattern = /\b(?:then|but|so|because)\b/giu;
const hardBoundaryPattern = /[;:\n]|[.!?](?=\s|$)/gu;

/** The words after the verb that close a protection, the refinement grammar's own plus the ones it shares. */
const closerPattern = new RegExp(
    String.raw`\b(?:alone|intact|be|as\s+they\s+are|${refinementProtectionForms.closingPhrase}|should\s+not\s+change)\b`,
    'giu'
);
const headlessCloserPattern = new RegExp(
    String.raw`\b(?:as\s+they\s+are|${refinementProtectionForms.closingPhrase}|should\s+not\s+change|intact)\b`,
    'giu'
);
/** Marks a search over a piece with no protection verb, where `intact` closes only after a state verb. */
const HEADLESS = 'headless';
const TRAILING_FILLER = /^[\s,]*(?:(?:please|thanks|thank\s+you|too|now|for\s+now)[\s,]*)*$/iu;
const STATE_VERBS = /\s+(?:stays?|remains?|should\s+(?:stay|remain)|must\s+(?:stay|remain)|is|are)\s*$/iu;
/** A piece that opens on a protection verb is a title-cased request the verb readers skipped, not a subject. */
const OPENS_WITH_PROTECTION_VERB = new RegExp(String.raw`^\s*${PROTECTION_VERB}\b`, 'iu');
const LAST_WITH = /\bwith\s+(?![\s\S]*\bwith\s)/iu;

type StartKind = 'verb' | 'prohibition' | 'carve-out';
type Event = { index: number; end: number; kind: StartKind | 'cut' };
type Piece = { start: number; end: number; lead: { kind: StartKind; end: number; text: string } | null };
export type Slot = {
    start: number;
    end: number;
    /** Whether a closing word shows the clause is a closed protection, which a selection phrase needs. */
    strict: boolean;
    /** The word that closed the slot. */
    closer: string | null;
    /** Whether the slot only exempts what it names from a protection beside it ("leave Bass alone except Keys"). */
    exempts: boolean;
    /** Whether `otherwise` closes or follows the protection: it keeps everything but the request's own targets. */
    otherwise: boolean;
};
export type Range = { start: number; end: number };

/**
 * A capitalized word inside a sentence belongs to a title-cased name ("Keep Them Separate"), not to a request,
 * unless a conjunction opens its clause ("but Keep the Drum Bus unchanged").
 */
function opensTitleCasedPhrase(masked: string, index: number): boolean {
    return /^\p{Lu}/u.test(masked.slice(index)) && !opensClause(masked, index) && !followsConjunction(masked, index);
}

function followsConjunction(masked: string, index: number): boolean {
    return /\b(?:and|but|then|so)$/iu.test(masked.slice(0, index).trimEnd());
}

/** Whether a clause starts at the index: a sentence start, or after a semicolon or colon. */
function opensClause(masked: string, index: number): boolean {
    return isSentenceInitial(masked, index) || /[;:]$/u.test(masked.slice(0, index).trimEnd());
}

function isSentenceInitial(masked: string, index: number): boolean {
    const before = masked.slice(0, index).trimEnd();
    return before.length === 0 || /[.!?\n]$/u.test(before);
}

function collectEvents(masked: string): Event[] {
    const starts: Event[] = startPatterns.flatMap(({ kind, pattern }) =>
        Array.from(masked.matchAll(pattern), (match) => ({
            index: match.index,
            end: match.index + match[0].length,
            kind,
        })).filter((start) => !opensTitleCasedPhrase(masked, start.index))
    );
    const insideStart = (index: number) => starts.some((start) => index >= start.index && index < start.end);
    const cuts: Event[] = [hardBoundaryPattern, instructionPattern, conjunctionPattern].flatMap((pattern) =>
        Array.from(masked.matchAll(pattern), (match) => ({
            index: match.index,
            end: match.index + match[0].length,
            kind: 'cut' as const,
        })).filter((cut) => !insideStart(cut.index))
    );
    return [...starts, ...cuts].toSorted((left, right) => left.index - right.index || right.end - left.end);
}

/** The text cut at boundaries, instruction verbs and conjunctions, and before every protection start. */
function splitPieces(masked: string): Piece[] {
    const pieces: Piece[] = [];
    let cursor = 0;
    let lead: Piece['lead'] = null;
    for (const event of collectEvents(masked)) {
        if (event.index < cursor) {
            continue;
        }
        pieces.push({ start: cursor, end: event.index, lead });
        if (event.kind === 'cut') {
            cursor = event.end;
            lead = null;
        } else {
            cursor = event.index;
            lead = { kind: event.kind, end: event.end, text: masked.slice(event.index, event.end) };
        }
    }
    pieces.push({ start: cursor, end: masked.length, lead });
    return pieces;
}

type Closer = Range & { word: string };

/** The first closing word of a text whose closure is sound: "the same" closes only the clause it ends. */
function findCloser(masked: string, from: number, end: number, pattern: RegExp, verb: string | null): Closer | null {
    for (const match of masked.slice(from, end).matchAll(pattern)) {
        const word = match[0].toLowerCase();
        const closerEnd = from + match.index + match[0].length;
        if (word === 'be' && !/^leav/iu.test(verb ?? '')) {
            continue;
        }
        if (/^the\s+same$/u.test(word) && !TRAILING_FILLER.test(masked.slice(closerEnd, end))) {
            continue;
        }
        if (verb === HEADLESS && word === 'intact' && !STATE_VERBS.test(masked.slice(from, from + match.index))) {
            continue;
        }
        return { start: from + match.index, end: closerEnd, word };
    }
    return null;
}

/** The reference a piece protects, and whether a closing word shows it is read as a closed protection. */
function readSlot(masked: string, piece: Piece): Slot | null {
    const { lead } = piece;
    if (lead === null) {
        const closer = findCloser(masked, piece.start, piece.end, headlessCloserPattern, HEADLESS);
        if (closer === null || OPENS_WITH_PROTECTION_VERB.test(masked.slice(piece.start, piece.end))) {
            return null;
        }
        const before = masked.slice(piece.start, closer.start);
        const withEnd = LAST_WITH.exec(before);
        const start = piece.start + (withEnd === null ? 0 : withEnd.index + withEnd[0].length);
        const end = closer.start - (STATE_VERBS.exec(before)?.[0].length ?? 0);
        return {
            start,
            end: Math.max(start, end),
            strict: true,
            closer: closer.word,
            exempts: false,
            otherwise: false,
        };
    }
    if (lead.kind === 'carve-out') {
        return { start: lead.end, end: piece.end, strict: true, closer: null, exempts: false, otherwise: false };
    }
    if (lead.kind === 'prohibition') {
        const closer = findCloser(masked, lead.end, piece.end, closerPattern, null);
        return {
            start: lead.end,
            end: closer?.start ?? piece.end,
            strict: true,
            closer: closer?.word ?? null,
            exempts: false,
            otherwise: false,
        };
    }
    const closer = findCloser(masked, lead.end, piece.end, closerPattern, lead.text);
    return {
        start: lead.end,
        end: closer?.start ?? piece.end,
        strict: closer !== null,
        closer: closer?.word ?? null,
        exempts: false,
        otherwise: false,
    };
}

/** A carve-out of what the request itself does ("other than that", "besides that"), which reads as `otherwise`. */
const CARVE_OUT_OF_REQUEST = /^[\s,]*(?:that|this)[\s,]*$/iu;

/**
 * Whether `otherwise` qualifies a protection: inside it, alone in the piece right before it ("but otherwise
 * leave the Drums alone"), or as a carve-out of the request right before or after it ("other than that leave
 * the Drums alone", "leave the Drums alone besides that").
 */
function readsOtherwise(masked: string, pieces: readonly Piece[], index: number): boolean {
    const isCarveOutOfRequest = (piece: Piece | undefined) =>
        piece?.lead?.kind === 'carve-out' && CARVE_OUT_OF_REQUEST.test(masked.slice(piece.lead.end, piece.end));
    const before = pieces[index - 1];
    const own = pieces[index];
    return (
        (own !== undefined && /\botherwise\b/iu.test(masked.slice(own.start, own.end))) ||
        (before !== undefined && /^[\s,]*otherwise[\s,]*$/iu.test(masked.slice(before.start, before.end))) ||
        isCarveOutOfRequest(before) ||
        isCarveOutOfRequest(pieces[index + 1])
    );
}

/** Every slot of the text, a carve-out right after a protection marked as only exempting from it. */
function readSlots(masked: string): Slot[] {
    const slots: Slot[] = [];
    const pieces = splitPieces(masked);
    let previousProtects = false;
    for (const [index, piece] of pieces.entries()) {
        const slot = readSlot(masked, piece);
        if (slot === null) {
            previousProtects = false;
            continue;
        }
        const isCarveOut = piece.lead?.kind === 'carve-out';
        const otherwise = readsOtherwise(masked, pieces, index);
        slots.push({ ...slot, exempts: isCarveOut && previousProtects, otherwise });
        previousProtects = piece.lead?.kind === 'verb' || piece.lead?.kind === 'prohibition';
    }
    return slots;
}

export const protectionSlots = { read: readSlots } as const;
