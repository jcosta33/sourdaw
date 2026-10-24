import { type ProjectContext } from '../../models/ProjectContext';
import { scanPromptQuotedText } from '../../transformers/promptParser/promptQuotedText';

import { refinementProtectionForms } from './refinementProtectionForms';
import { refinementRequestReading, type ReferenceCandidate } from './refinementRequestReading';

/**
 * An explicit protection is a preservation clause ("leave Keys alone", "with Bass unchanged", "Keys
 * stays as is"), a prohibition ("do not change the fader of Strings", "without touching Keys",
 * "no changes to Keys") or a carve-out ("except the second one"). Its closing words are the
 * refinement grammar's own closed forms.
 *
 * A protection fails to bind only through a reference clearly meant as a project object that resolves
 * to none: a capitalized name that stands alone as a list member of a protection ("leave the Kick
 * alone", "except for the Intro", "the fader of Ghost", "Ghost stays as is"), a position ("the first
 * track", "track 2") the shared resolver does not bind, or a selection phrase ("this track", "it")
 * with nothing selected or named. A name inside quotes, a title-cased phrase, a trailing clause
 * ("until Friday") and any word that is a quality, the rest of the mix, a project setting, filler, a
 * kind noun, notes, a marker or section is no target and never unresolved. Project names are read
 * whole before the text is cut at punctuation or a stop word, so "Dr. Beat" and "Home Alone" bind as
 * the names they are.
 */

export type ProtectionReading = {
    /** Every reference of a protection clearly meant as an object that binds to none, as written, once each. */
    unresolved: string[];
    /** Tracks a protection leaves wholly alone: the selected track through a selection phrase, a VCA group's members. */
    protectedTrackIds: string[];
    /** Tracks a protection leaves alone only through the operations it names ("keep its pan as is"). */
    protectedControls: Array<{ trackId: string; actionTypes: string[] }>;
};

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
    String.raw`\b(?:as\s+they\s+are|${refinementProtectionForms.closingPhrase}|should\s+not\s+change)\b`,
    'giu'
);
const TRAILING_FILLER = /^[\s,]*(?:(?:please|thanks|thank\s+you|too|now|for\s+now)[\s,]*)*$/iu;
const STATE_VERBS = /\s+(?:stays?|remains?|should\s+(?:stay|remain)|must\s+(?:stay|remain)|is|are)\s*$/iu;
/** A piece that opens on a protection verb is a title-cased request the verb readers skipped, not a subject. */
const OPENS_WITH_PROTECTION_VERB = new RegExp(String.raw`^\s*${PROTECTION_VERB}\b`, 'iu');
const LAST_WITH = /\bwith\s+(?![\s\S]*\bwith\s)/iu;

const POSITION =
    /\b(?:the\s+)?(?:(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|final|next|previous|\d+(?:st|nd|rd|th))\s+(?:audio\s+|midi\s+|bus\s+)?(?:tracks?|ones?|channels?|buses|bus|clips?)|tracks?\s+\d+)\b/iu;
const SELECTION_PHRASES: ReadonlyMap<string, 'any' | 'track'> = new Map([
    ['it', 'any'],
    ['its', 'any'],
    ['this', 'any'],
    ['this one', 'any'],
    ['selected', 'any'],
    ['selected one', 'any'],
    ['current one', 'any'],
    ['this track', 'track'],
    ['this channel', 'track'],
    ['selected track', 'track'],
    ['selected channel', 'track'],
    ['current track', 'track'],
    ['current channel', 'track'],
]);
const MEMBER_SEPARATOR = /\s*,\s*|\s+(?:and|or|as\s+well\s+as|along\s+with|together\s+with|plus)\s+|\s*&\s*/giu;
/** A phrase naming the rest of the mix, which stands for no particular object a protection must bind. */
const REST_OF_MIX =
    /^(?:everything(?:\s+else)?|anything\s+else|all\s+else|the\s+rest(?:\s+of\s+(?:it|the\s+(?:mix|project|tracks|session|arrangement|song)))?|(?:all\s+)?(?:the\s+)?other\s+tracks|every\s+other\s+track|the\s+others|the\s+remaining\s+tracks)(?:\s+(?:the\s+same|as\s+is))?$/iu;
/** A project-wide setting, which no object a batch could target carries. */
const PROJECT_SETTING =
    /^(?:the\s+)?(?:tempo|bpm|time\s+signature|meter|key\s+signature|loop(?:\s+region)?|metronome)$/iu;
const CONNECTIVE_WORDS: ReadonlySet<string> = new Set([
    'the',
    'a',
    'an',
    'of',
    'and',
    'or',
    'both',
    'my',
    'your',
    'our',
    'in',
    'on',
    'at',
    'to',
    'for',
    'from',
    'by',
    'with',
    'into',
    'than',
]);
const CONTROL_WORDS: ReadonlySet<string> = new Set([
    'pan',
    'panning',
    'solo',
    'mute',
    'fader',
    'faders',
    'gain',
    'level',
    'volume',
    'arm',
    'send',
    'sends',
    'routing',
    'output',
    'settings',
    'setting',
]);
const SEND_ACTIONS: readonly string[] = ['addSend', 'removeSend', 'setSend'];
/** Nouns that name a kind of object beside a name ("the Keys track", "the compressor"), never an object. */
const KIND_NOUNS: ReadonlySet<string> = new Set([
    'track',
    'tracks',
    'channel',
    'channels',
    'bus',
    'buses',
    'group',
    'groups',
    'clip',
    'clips',
    'plugin',
    'plugins',
    'device',
    'devices',
    'insert',
    'inserts',
    'return',
    'returns',
]);
/** Capitalized words that name no object: filler, qualities and project-wide terms. */
const NON_OBJECT_WORDS: ReadonlySet<string> = new Set([
    'please',
    'thanks',
    'thank',
    'you',
    'too',
    'also',
    'either',
    'though',
    'otherwise',
    'now',
    'again',
    'okay',
    'ok',
    'groove',
    'vibe',
    'tone',
    'feel',
    'mix',
    'dynamics',
    'balance',
    'energy',
    'warmth',
    'punch',
    'sound',
    'character',
    'timing',
    'arrangement',
    'structure',
    'song',
    'project',
    'tempo',
    'key',
    'loop',
    'metronome',
    'click',
    'compressor',
    'reverb',
    'delay',
    'master',
    'notes',
    'midi',
    'marker',
    'markers',
    'section',
    'sections',
    'selected',
    'current',
]);

type StartKind = 'verb' | 'prohibition' | 'carve-out';
type Event = { index: number; end: number; kind: StartKind | 'cut' };
type Piece = { start: number; end: number; lead: { kind: StartKind; end: number; text: string } | null };
type Slot = {
    start: number;
    end: number;
    /** Whether a closing word shows the clause is a closed protection, which a selection phrase needs. */
    strict: boolean;
    /** The word that closed the slot; `intact` keeps a quality, never an object. */
    closer: string | null;
    /** Whether the slot only exempts what it names from a protection beside it ("leave Bass alone except Keys"). */
    exempts: boolean;
};
type Range = { start: number; end: number };

/** A capitalized word inside a sentence belongs to a title-cased name ("Keep Them Separate"), not to a request. */
function opensTitleCasedPhrase(masked: string, index: number): boolean {
    return /^\p{Lu}/u.test(masked.slice(index)) && !isSentenceInitial(masked, index);
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
        return { start: from + match.index, end: closerEnd, word };
    }
    return null;
}

/** The reference a piece protects, and whether a closing word shows it is read as a closed protection. */
function readSlot(masked: string, piece: Piece): Slot | null {
    const { lead } = piece;
    if (lead === null) {
        const closer = findCloser(masked, piece.start, piece.end, headlessCloserPattern, null);
        if (closer === null || OPENS_WITH_PROTECTION_VERB.test(masked.slice(piece.start, piece.end))) {
            return null;
        }
        const before = masked.slice(piece.start, closer.start);
        const withEnd = LAST_WITH.exec(before);
        const start = piece.start + (withEnd === null ? 0 : withEnd.index + withEnd[0].length);
        const end = closer.start - (STATE_VERBS.exec(before)?.[0].length ?? 0);
        return { start, end: Math.max(start, end), strict: true, closer: closer.word, exempts: false };
    }
    if (lead.kind === 'carve-out') {
        return { start: lead.end, end: piece.end, strict: true, closer: null, exempts: false };
    }
    if (lead.kind === 'prohibition') {
        const closer = findCloser(masked, lead.end, piece.end, closerPattern, null);
        return {
            start: lead.end,
            end: closer?.start ?? piece.end,
            strict: true,
            closer: closer?.word ?? null,
            exempts: false,
        };
    }
    const closer = findCloser(masked, lead.end, piece.end, closerPattern, lead.text);
    return {
        start: lead.end,
        end: closer?.start ?? piece.end,
        strict: closer !== null,
        closer: closer?.word ?? null,
        exempts: false,
    };
}

/** Every slot of the text, a carve-out right after a protection marked as only exempting from it. */
function readSlots(masked: string): Slot[] {
    const slots: Slot[] = [];
    let previousProtects = false;
    for (const piece of splitPieces(masked)) {
        const slot = readSlot(masked, piece);
        if (slot === null) {
            previousProtects = false;
            continue;
        }
        const isCarveOut = piece.lead?.kind === 'carve-out';
        slots.push({ ...slot, exempts: isCarveOut && previousProtects });
        previousProtects = piece.lead?.kind === 'verb' || piece.lead?.kind === 'prohibition';
    }
    return slots;
}

type Token = { text: string; lower: string; quoted: boolean };

function readTokens(blanked: string, masked: string, range: Range): Token[] {
    return Array.from(blanked.slice(range.start, range.end).matchAll(/[\p{L}\p{N}□]+/gu), (match) => {
        const index = range.start + match.index;
        return {
            text: match[0],
            lower: match[0].toLocaleLowerCase(),
            quoted: masked[index] === ' ' && blanked[index] !== ' ',
        };
    });
}

function isCapitalizedName(token: Token): boolean {
    return (
        /^\p{Lu}/u.test(token.text) &&
        token.text.length > 1 &&
        token.text !== token.text.toLocaleUpperCase() &&
        !NON_OBJECT_WORDS.has(token.lower) &&
        !token.text.includes('□')
    );
}

type MemberReading =
    | { kind: 'ignore' }
    | { kind: 'unknown'; text: string }
    | { kind: 'position'; text: string }
    | { kind: 'controls'; controls: string[] }
    | { kind: 'selection'; phrase: string; scope: 'any' | 'track'; controls: string[]; pronoun: boolean };

/** What one member of a protection's list names: a position, a selection, controls, or a name no object carries. */
function readMember(tokens: readonly Token[], phrase: string, slot: Slot, possessive: boolean): MemberReading {
    const lowered = tokens.map((token) => token.lower).join(' ');
    if (REST_OF_MIX.test(lowered) || PROJECT_SETTING.test(lowered)) {
        return { kind: 'ignore' };
    }
    const content = tokens.filter((token) => !CONNECTIVE_WORDS.has(token.lower));
    const controls = content.filter((token) => CONTROL_WORDS.has(token.lower)).map((token) => token.lower);
    const named = content.filter((token) => !CONTROL_WORDS.has(token.lower) && !KIND_NOUNS.has(token.lower));
    const position = POSITION.exec(lowered);
    if (position !== null) {
        const rest = lowered.replace(position[0], ' ').split(/\s+/u);
        const leftover = rest.filter(
            (word) =>
                word.length > 0 && !CONNECTIVE_WORDS.has(word) && !CONTROL_WORDS.has(word) && !KIND_NOUNS.has(word)
        );
        if (leftover.length === 0) {
            return { kind: 'position', text: position[0].replace(/^the\s+/u, '') };
        }
    }
    const selectionPhrase = content
        .filter((token) => !CONTROL_WORDS.has(token.lower))
        .map((token) => token.lower)
        .join(' ');
    const scope = SELECTION_PHRASES.get(selectionPhrase);
    if (scope !== undefined && slot.strict) {
        return {
            kind: 'selection',
            phrase,
            scope,
            controls,
            pronoun: selectionPhrase === 'it' || selectionPhrase === 'its',
        };
    }
    if (
        content.length > 0 &&
        named.length === 0 &&
        controls.length > 0 &&
        content.every((t) => CONTROL_WORDS.has(t.lower))
    ) {
        return { kind: 'controls', controls };
    }
    const hasObjectMarker =
        possessive || content.some((token) => CONTROL_WORDS.has(token.lower) || KIND_NOUNS.has(token.lower));
    const names = named.filter((token) => token.lower !== 's');
    const aloneAsName = names.length > 0 && names.every(isCapitalizedName);
    const quotedWithoutObject = names.some((token) => token.quoted) && !hasObjectMarker;
    if (aloneAsName && !quotedWithoutObject && slot.closer !== 'intact') {
        return { kind: 'unknown', text: names.map((token) => token.text).join(' ') };
    }
    return { kind: 'ignore' };
}

type SelectionMember = {
    phrase: string;
    scope: 'any' | 'track';
    controls: string[];
    pronoun: boolean;
    anaphoric: boolean;
};
type SlotReading = { unresolved: string[]; selection: SelectionMember[] };

function readSlotMembers(input: { prompt: string; blanked: string; masked: string; slot: Slot }): SlotReading {
    const { prompt, blanked, masked, slot } = input;
    const reading: SlotReading = { unresolved: [], selection: [] };
    const bounds: Range[] = [];
    let start = slot.start;
    for (const separator of masked.slice(slot.start, slot.end).matchAll(MEMBER_SEPARATOR)) {
        bounds.push({ start, end: slot.start + separator.index });
        start = slot.start + separator.index + separator[0].length;
    }
    bounds.push({ start, end: slot.end });
    let namedBefore = false;
    let lastSelection: SelectionMember | null = null;
    for (const range of bounds) {
        const raw = readTokens(blanked, masked, range);
        const isPossessiveS = (token: Token, index: number) => token.lower === 's' && index > 0;
        const tokens = raw.filter((token, index) => !isPossessiveS(token, index));
        const phrase = prompt.slice(range.start, range.end).trim();
        const member = readMember(tokens, phrase, slot, raw.some(isPossessiveS));
        if (member.kind === 'unknown' || member.kind === 'position') {
            reading.unresolved.push(member.text);
        } else if (member.kind === 'selection') {
            lastSelection = {
                ...member,
                anaphoric: member.pronoun && member.phrase.toLocaleLowerCase().startsWith('its') && namedBefore,
            };
            reading.selection.push(lastSelection);
            namedBefore ||= tokens.some((token) => token.text.includes('□'));
            continue;
        } else if (member.kind === 'controls' && lastSelection !== null) {
            lastSelection.controls.push(...member.controls);
        }
        if (member.kind !== 'controls') {
            lastSelection = null;
        }
        namedBefore ||= tokens.some((token) => token.text.includes('□'));
    }
    return reading;
}

/** The extra names a project holds that the refinement reader's candidates leave out. */
function getExtraCandidates(context: ProjectContext): ReferenceCandidate[] {
    const groups: Array<ReadonlyArray<{ id: string; name: string }> | undefined> = [
        context.markers,
        context.sections,
        context.automationLanes,
        context.adjustmentLayers,
    ];
    const named = groups.flatMap((objects) => objects ?? []);
    return named.map((object) => ({
        name: object.name
            .toLocaleLowerCase()
            .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
            .trim(),
        denotes: new Set([object.id]),
    }));
}

function blankRanges(text: string, ranges: readonly Range[]): string {
    return ranges.reduce(
        (blanked, { start, end }) => `${blanked.slice(0, start)}${'□'.repeat(end - start)}${blanked.slice(end)}`,
        text
    );
}

function hasSelectedClip(context: ProjectContext): boolean {
    return context.selectedClipId !== null || context.selectedClipIds.length > 0;
}

type Accumulator = {
    unresolved: Set<string>;
    wholeTrackIds: Set<string>;
    controls: Map<string, Set<string>>;
};

/** The action types a control word names, or undefined when it names none, which makes it the whole track. */
function readControlActions(control: string): readonly string[] | undefined {
    if (control === 'send' || control === 'sends') {
        return SEND_ACTIONS;
    }
    return refinementRequestReading.operationActions[control === 'faders' ? 'fader' : control];
}

function protectControls(found: Accumulator, trackId: string, controls: readonly string[]): void {
    const actionLists = controls.map(readControlActions);
    if (controls.length === 0 || actionLists.some((actions) => actions === undefined)) {
        found.wholeTrackIds.add(trackId);
        return;
    }
    const actions = found.controls.get(trackId) ?? new Set<string>();
    for (const list of actionLists) {
        for (const action of list ?? []) {
            actions.add(action);
        }
    }
    found.controls.set(trackId, actions);
}

/** Whether a selection phrase has something to bind to: a track-scoped one needs a selected track. */
function bindsToSelection(scope: 'any' | 'track', hasSelectedTrack: boolean, context: ProjectContext): boolean {
    if (scope === 'track') {
        return hasSelectedTrack;
    }
    return hasSelectedTrack || hasSelectedClip(context);
}

type SelectionContext = { context: ProjectContext; targetTrackIds: ReadonlySet<string>; protects: boolean };

/** Reads what each selection phrase of a slot binds to: the request's one named target, the selection, or nothing. */
function readSelectionMembers(
    selection: readonly SelectionMember[],
    where: SelectionContext,
    found: Accumulator
): void {
    const { context, targetTrackIds, protects } = where;
    const selectedTrack = context.tracks.find((track) => track.id === context.selectedTrackId);
    for (const member of selection) {
        if (member.anaphoric) {
            continue;
        }
        if (member.pronoun && targetTrackIds.size > 1) {
            found.unresolved.add(member.phrase);
            continue;
        }
        const [ownTarget] = targetTrackIds;
        if (member.pronoun && ownTarget !== undefined) {
            // "it" and "its" point at the request's one named target, whose own change a bare protection of it cannot forbid.
            if (
                protects &&
                member.controls.length > 0 &&
                member.controls.every((control) => readControlActions(control) !== undefined)
            ) {
                protectControls(found, ownTarget, member.controls);
            }
            continue;
        }
        if (!bindsToSelection(member.scope, selectedTrack !== undefined, context)) {
            found.unresolved.add(member.phrase);
        } else if (protects && selectedTrack !== undefined) {
            protectControls(found, selectedTrack.id, member.controls);
        }
    }
}

/** The member tracks of every VCA group the slot names. */
function readVcaMemberTracks(
    references: ReadonlyArray<{ start: number; end: number; denotes: ReadonlySet<string> }>,
    slot: Slot,
    vcaGroups: ReadonlyMap<string, readonly string[]>
): string[] {
    return references
        .filter((reference) => reference.start >= slot.start && reference.end <= slot.end)
        .flatMap((reference) => Array.from(reference.denotes).flatMap((id) => vcaGroups.get(id) ?? []));
}

/** The tracks the request names outside every protection slot: what "it" can point at. */
function readTargetTrackIds(
    references: ReadonlyArray<{ start: number; end: number; denotes: ReadonlySet<string> }>,
    slots: readonly Slot[],
    context: ProjectContext
): Set<string> {
    const trackIds = new Set(context.tracks.map((track) => track.id));
    const targets = new Set<string>();
    for (const reference of references) {
        if (slots.some((slot) => reference.start >= slot.start && reference.end <= slot.end)) {
            continue;
        }
        for (const id of reference.denotes) {
            if (trackIds.has(id)) {
                targets.add(id);
            }
        }
    }
    return targets;
}

/**
 * Reads every explicit protection clause of the request. A protection holding a reference clearly meant
 * as an object that binds to none is reported unresolved; a protection that resolves through the
 * selected track, the request's one named target or a VCA group is reported with what it keeps.
 */
export function readExplicitProtections(prompt: string, context: ProjectContext): ProtectionReading {
    const candidates = [...refinementRequestReading.candidates(context), ...getExtraCandidates(context)];
    const references = refinementRequestReading.references(prompt, candidates);
    const blanked = blankRanges(prompt, references);
    const scanned = scanPromptQuotedText(prompt).maskedText;
    const masked = Array.from(blanked, (character, index) => (scanned[index] === prompt[index] ? character : ' ')).join(
        ''
    );
    const vcaGroups = new Map((context.vcaGroups ?? []).map((group) => [group.id, group.trackIds]));
    const found: Accumulator = { unresolved: new Set(), wholeTrackIds: new Set(), controls: new Map() };
    const slots = readSlots(masked);
    const targetTrackIds = readTargetTrackIds(references, slots, context);
    for (const slot of slots) {
        const reading = readSlotMembers({ prompt, blanked, masked, slot });
        for (const reference of reading.unresolved) {
            found.unresolved.add(reference);
        }
        if (slot.closer === 'intact') {
            continue;
        }
        readSelectionMembers(reading.selection, { context, targetTrackIds, protects: !slot.exempts }, found);
        if (!slot.exempts) {
            for (const trackId of readVcaMemberTracks(references, slot, vcaGroups)) {
                found.wholeTrackIds.add(trackId);
            }
        }
    }
    return {
        unresolved: [...found.unresolved],
        protectedTrackIds: [...found.wholeTrackIds],
        protectedControls: Array.from(found.controls, ([trackId, actions]) => ({ trackId, actionTypes: [...actions] })),
    };
}
