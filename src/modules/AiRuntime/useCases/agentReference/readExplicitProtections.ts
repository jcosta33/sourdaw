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
 * A protection fails to bind only through a reference that names a concrete object and resolves to
 * none: a quoted name, a capitalized name no track, clip, device, VCA group, marker or section carries,
 * a position ("the first track", "track 2") the shared resolver does not bind, or a selection phrase
 * ("it", "this track") with nothing selected. Everything else a protection holds is no target and is
 * never unresolved: a quality ("the groove"), the rest of the mix, a project setting, filler, a kind
 * noun beside a name ("the Keys track", "the compressor"), notes or the selected clip. Project names
 * are read whole before the text is cut at punctuation or a stop word, so "Dr. Beat" and "Home Alone"
 * bind as the names they are.
 */

export type ProtectionReading = {
    /** Every concrete reference of a protection that binds to no object, as written, once each. */
    unresolved: string[];
    /** Whether a protection leaves the whole selected track alone ("leave this track alone"). */
    protectsSelectedTrack: boolean;
    /** The action types a protection of one control of the selected track keeps ("keep its pan as is"). */
    selectedTrackControlActions: string[];
    /** The member tracks of every VCA group a protection names, which it protects as it protects the group. */
    protectedVcaTrackIds: string[];
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
const hardBoundaryPattern = /[;\n]|[.!?](?=\s|$)/gu;

/** The words after the verb that close a protection, the refinement grammar's own plus the ones it shares. */
const closerPattern = new RegExp(
    String.raw`\b(?:alone|intact|be|as\s+they\s+are|${refinementProtectionForms.closingPhrase}|should\s+not\s+change)\b`,
    'giu'
);
const headlessCloserPattern = new RegExp(
    String.raw`\b(?:${refinementProtectionForms.closingPhrase}|should\s+not\s+change)\b`,
    'giu'
);
const TRAILING_FILLER = /^[\s,]*(?:(?:please|thanks|thank\s+you|too|now|for\s+now)[\s,]*)*$/iu;
const STATE_VERBS = /\s+(?:stays?|remains?|should\s+(?:stay|remain)|must\s+(?:stay|remain)|is|are)\s*$/iu;
const LEADING_WITH = /^\s*with\s+/iu;

const POSITION =
    /\b(?:(?:the\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|final|next|previous|\d+(?:st|nd|rd|th))\s+(?:audio\s+|midi\s+|bus\s+)?(?:tracks?|ones?|channels?|buses|bus|clips?)|tracks?\s+\d+)\b/iu;
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
const FILLER_WORDS: ReadonlySet<string> = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'both', 'my', 'your', 'our']);
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
/** Capitalized words that name no object: filler, qualities, kinds of object and project-wide terms. */
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
    'track',
    'tracks',
    'channel',
    'channels',
    'bus',
    'buses',
    'return',
    'returns',
    'group',
    'groups',
    'plugin',
    'plugins',
    'insert',
    'inserts',
    'effect',
    'effects',
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
    'clip',
    'clips',
    'selected',
    'current',
]);

type StartKind = 'verb' | 'prohibition' | 'carve-out';
type Event = { index: number; end: number; kind: StartKind | 'cut' };
type Piece = { start: number; end: number; lead: { kind: StartKind; end: number; text: string } | null };
type Slot = { start: number; end: number; strict: boolean; carveOut: boolean };
type Range = { start: number; end: number };

/** A capitalized word inside a sentence belongs to a title-cased name ("Keep Them Separate"), not to a request. */
function opensTitleCasedPhrase(masked: string, index: number): boolean {
    return /^\p{Lu}/u.test(masked.slice(index)) && !isSentenceInitial(masked, index);
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

/** The first closing word of a text whose closure is sound: "the same" closes only the clause it ends. */
function findCloser(masked: string, from: number, end: number, pattern: RegExp, verb: string | null): Range | null {
    for (const match of masked.slice(from, end).matchAll(pattern)) {
        const closer = match[0].toLowerCase();
        const closerEnd = from + match.index + match[0].length;
        if (closer === 'be' && !/^leav/iu.test(verb ?? '')) {
            continue;
        }
        if (/^the\s+same$/u.test(closer) && !TRAILING_FILLER.test(masked.slice(closerEnd, end))) {
            continue;
        }
        return { start: from + match.index, end: closerEnd };
    }
    return null;
}

/** The reference a piece protects, and whether a closing word shows it is read as a closed protection. */
function readSlot(masked: string, piece: Piece): Slot | null {
    const { lead } = piece;
    if (lead === null) {
        const closer = findCloser(masked, piece.start, piece.end, headlessCloserPattern, null);
        if (closer === null) {
            return null;
        }
        const before = masked.slice(piece.start, closer.start);
        const start = piece.start + (LEADING_WITH.exec(before)?.[0].length ?? 0);
        return {
            start,
            end: closer.start - (STATE_VERBS.exec(before)?.[0].length ?? 0),
            strict: true,
            carveOut: false,
        };
    }
    if (lead.kind === 'carve-out') {
        return { start: lead.end, end: piece.end, strict: true, carveOut: true };
    }
    if (lead.kind === 'prohibition') {
        const closer = findCloser(masked, lead.end, piece.end, closerPattern, null);
        return { start: lead.end, end: closer?.start ?? piece.end, strict: true, carveOut: false };
    }
    const closer = findCloser(masked, lead.end, piece.end, closerPattern, lead.text);
    return { start: lead.end, end: closer?.start ?? piece.end, strict: closer !== null, carveOut: false };
}

/** The runs of a quoted label's content, each as the range between its quotation marks. */
function findQuotedRanges(text: string, masked: string): Range[] {
    const runs = Array.from(text.matchAll(/\S+/gu), (match) => ({
        start: match.index,
        end: match.index + match[0].length,
    })).flatMap((word) => {
        const hidden: Range[] = [];
        for (let index = word.start; index < word.end; index += 1) {
            if (masked[index] !== text[index]) {
                const last = hidden.at(-1);
                if (last !== undefined && last.end === index) {
                    last.end = index + 1;
                } else {
                    hidden.push({ start: index, end: index + 1 });
                }
            }
        }
        return hidden;
    });
    return runs.reduce<Range[]>((joined, run) => {
        const last = joined.at(-1);
        if (last !== undefined && /^\s*$/u.test(text.slice(last.end, run.start))) {
            last.end = run.end;
            return joined;
        }
        return [...joined, run];
    }, []);
}

function isSentenceInitial(masked: string, index: number): boolean {
    const before = masked.slice(0, index).trimEnd();
    return before.length === 0 || /[.!?;:\n]$/u.test(before);
}

function opensWithConcreteReference(text: string): boolean {
    const trimmed = text.replace(/^[\s"'“‘]*(?:(?:the|a|an|my|your|our|both|all|any)\s+)*/iu, (opening) => opening);
    const stripped = trimmed.replace(/^\s*(?:(?:the|a|an|my|your|our|both|all|any)\s+)*/iu, '');
    return /^["'“‘]/u.test(trimmed.trimStart()) || /^\p{Lu}/u.test(stripped) || POSITION.test(stripped.slice(0, 40));
}

type SlotReading = {
    unresolved: string[];
    selection: { phrase: string; scope: 'any' | 'track'; controls: string[]; anaphoric: boolean }[];
};

function readSlotReferences(input: {
    prompt: string;
    blanked: string;
    masked: string;
    quotedRanges: readonly Range[];
    slot: Slot;
}): SlotReading {
    const { prompt, blanked, masked, quotedRanges, slot } = input;
    const text = blanked.slice(slot.start, slot.end);
    const reading: SlotReading = { unresolved: [], selection: [] };
    if (!slot.strict && !opensWithConcreteReference(text)) {
        return reading;
    }
    for (const quoted of quotedRanges) {
        const content = blanked.slice(quoted.start, quoted.end);
        if (quoted.start >= slot.start && quoted.end <= slot.end && /[\p{L}\p{N}]/u.test(content)) {
            reading.unresolved.push(prompt.slice(quoted.start, quoted.end).trim());
        }
    }
    const maskedText = masked.slice(slot.start, slot.end);
    for (const word of maskedText.matchAll(/\p{L}[\p{L}\p{N}]*/gu)) {
        const spoken = word[0];
        const named =
            /^\p{Lu}/u.test(spoken) &&
            spoken.length > 1 &&
            spoken !== spoken.toLocaleUpperCase() &&
            !NON_OBJECT_WORDS.has(spoken.toLocaleLowerCase()) &&
            !isSentenceInitial(masked, slot.start + word.index);
        if (named) {
            reading.unresolved.push(spoken);
        }
    }
    const position = POSITION.exec(maskedText);
    if (position !== null) {
        reading.unresolved.push(position[0].replace(/^the\s+/iu, ''));
    }
    if (slot.carveOut) {
        return reading;
    }
    reading.selection = splitSelectionMembers(text);
    return reading;
}

function splitSelectionMembers(slotText: string): SlotReading['selection'] {
    const selection: SlotReading['selection'] = [];
    let namedBefore = false;
    for (const member of slotText.split(MEMBER_SEPARATOR)) {
        const words = member
            .toLocaleLowerCase()
            .split(/[^\p{L}\p{N}□]+/u)
            .filter((word) => word.length > 0 && !FILLER_WORDS.has(word));
        const controls = words.filter((word) => CONTROL_WORDS.has(word));
        const rest = words.filter((word) => !CONTROL_WORDS.has(word)).join(' ');
        const scope = SELECTION_PHRASES.get(rest);
        if (scope !== undefined) {
            selection.push({ phrase: member.trim(), scope, controls, anaphoric: rest === 'its' && namedBefore });
        }
        namedBefore ||= words.some((word) => word.includes('□'));
    }
    return selection;
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

/** Each name also in the other grammatical number, which a request states a name in ("the vocal"). */
function withNumberForms(candidates: readonly ReferenceCandidate[]): ReferenceCandidate[] {
    const known = new Set(candidates.map((candidate) => candidate.name));
    const forms = candidates.flatMap((candidate) => {
        const other = candidate.name.endsWith('s') ? candidate.name.slice(0, -1) : `${candidate.name}s`;
        return known.has(other) || other.length < 3 ? [] : [{ name: other, denotes: candidate.denotes }];
    });
    return [...candidates, ...forms].filter((candidate) => candidate.name.length > 0);
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
    controlActions: Set<string>;
    vcaTrackIds: Set<string>;
    protectsSelectedTrack: boolean;
};

/** Reads what each selection phrase of a slot binds to, or reports it unresolved. */
function readSelectionMembers(selection: SlotReading['selection'], context: ProjectContext, found: Accumulator): void {
    const selectedTrack = context.tracks.some((track) => track.id === context.selectedTrackId);
    for (const member of selection) {
        const resolvable = member.scope === 'track' ? selectedTrack : selectedTrack || hasSelectedClip(context);
        if (member.anaphoric) {
            continue;
        }
        if (!resolvable) {
            found.unresolved.add(member.phrase);
        } else if (selectedTrack && member.controls.length === 0) {
            found.protectsSelectedTrack = true;
        } else if (selectedTrack) {
            const actions = member.controls.flatMap(
                (control) => refinementRequestReading.operationActions[control] ?? []
            );
            for (const action of actions) {
                found.controlActions.add(action);
            }
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

/**
 * Reads every explicit protection clause of the request. A protection that holds a concrete
 * reference binding to nothing is reported unresolved; a protection resolving through the selected
 * track, or naming a VCA group, is reported with what it keeps.
 */
export function readExplicitProtections(prompt: string, context: ProjectContext): ProtectionReading {
    const candidates = withNumberForms([
        ...refinementRequestReading.candidates(context),
        ...getExtraCandidates(context),
    ]);
    const references = refinementRequestReading.references(prompt, candidates);
    const blanked = blankRanges(prompt, references);
    const scanned = scanPromptQuotedText(prompt).maskedText;
    const masked = Array.from(blanked, (character, index) => (scanned[index] === prompt[index] ? character : ' ')).join(
        ''
    );
    const quotedRanges = findQuotedRanges(prompt, scanned);
    const vcaGroups = new Map((context.vcaGroups ?? []).map((group) => [group.id, group.trackIds]));
    const found: Accumulator = {
        unresolved: new Set(),
        controlActions: new Set(),
        vcaTrackIds: new Set(),
        protectsSelectedTrack: false,
    };
    for (const piece of splitPieces(masked)) {
        const slot = readSlot(masked, piece);
        if (slot === null) {
            continue;
        }
        const reading = readSlotReferences({ prompt, blanked, masked, quotedRanges, slot });
        for (const reference of reading.unresolved) {
            found.unresolved.add(reference);
        }
        readSelectionMembers(reading.selection, context, found);
        if (!slot.carveOut) {
            for (const trackId of readVcaMemberTracks(references, slot, vcaGroups)) {
                found.vcaTrackIds.add(trackId);
            }
        }
    }
    return {
        unresolved: [...found.unresolved],
        protectsSelectedTrack: found.protectsSelectedTrack,
        selectedTrackControlActions: [...found.controlActions],
        protectedVcaTrackIds: [...found.vcaTrackIds],
    };
}
