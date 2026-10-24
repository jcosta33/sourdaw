import { type ProjectContext } from '../../models/ProjectContext';
import { scanPromptQuotedText } from '../../transformers/promptParser/promptQuotedText';

import {
    CONNECTIVE_WORDS,
    KIND_NOUNS,
    PROJECT_SETTING,
    REST_OF_MIX,
    SEND_ACTIONS,
    CONTROL_WORDS,
    protectionObjectForms,
    type ProtectableObjectName,
    type Token,
} from './protectionObjectForms';
import { protectionSlots, type Range, type Slot } from './readProtectionSlots';
import { refinementRequestReading, type ReferenceCandidate } from './refinementRequestReading';

/**
 * An explicit protection is a preservation clause ("leave Keys alone", "with Bass unchanged", "Keys
 * stays as is"), a prohibition ("do not change the fader of Strings", "without touching Keys",
 * "no changes to Keys") or a carve-out ("except the second one"). Its closing words are the
 * refinement grammar's own closed forms.
 *
 * Protection wording cannot tell a project object that is absent from a quality, a brand or a name
 * nobody asked about ("leave the Kick alone" may name a track or a sound), so a reference refuses
 * only in a form that unambiguously names a project object and binds to none: a control of it
 * ("the fader of Ghost", "Ghost's fader"), a singular kind of it ("the Ghost track"), a position
 * ("the first track", "track 2") the shared resolver does not bind, or a selection phrase ("this
 * track", "it") with nothing selected or named. A bare name, a quality, a plural category ("the
 * Audio tracks"), title case, quoted text and any capitalization are no target. Project names are read
 * whole before the text is cut at punctuation or a stop word, so "Dr. Beat" and "Home Alone" bind as
 * the names they are.
 */

export type ProtectionReading = {
    /** Every reference of a protection that names a project object by one of the object forms and binds to none. */
    unresolved: string[];
    /** Tracks a protection leaves wholly alone: bound by name, through the selection, or as a VCA group's members. */
    protectedTrackIds: string[];
    /** The part of `protectedTrackIds` a protection names by track name alone. */
    namedTrackIds: string[];
    /** Tracks a protection leaves alone only through the operations it names ("keep its pan as is"). */
    protectedControls: Array<{ trackId: string; actionTypes: string[] }>;
};

const { isControl, readObjectForm, readTokens } = protectionObjectForms;

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
const PROTECTION_VERB_WORD = /^(?:leave|leaving|keep|keeping|preserve|preserving|retain|retaining)$/u;

type MemberReading =
    | { kind: 'ignore' }
    | { kind: 'unbound'; text: string }
    | { kind: 'position'; text: string }
    | { kind: 'controls'; controls: string[] }
    | { kind: 'bound'; controls: string[]; onlyNames: boolean }
    | { kind: 'variant'; trackIds: string[] }
    | { kind: 'selection'; phrase: string; scope: 'any' | 'track'; controls: string[]; pronoun: boolean };

function countLeadingVerbs(tokens: readonly Token[]): number {
    const firstOther = tokens.findIndex((token) => !PROTECTION_VERB_WORD.test(token.lower));
    return firstOther === -1 ? tokens.length : firstOther;
}

const isBoundToken = (token: Token) => token.text.includes('□');

type MemberInput = {
    tokens: readonly Token[];
    phrase: string;
    slot: Slot;
    possessive: boolean;
    objects: readonly ProtectableObjectName[];
};

/** What one member of a protection's list names: a position, a selection, a bound object, or an unbound object form. */
function readMember(input: MemberInput): MemberReading {
    const { phrase, slot, possessive, objects } = input;
    const tokens = input.tokens.slice(countLeadingVerbs(input.tokens));
    const lowered = tokens.map((token) => token.lower).join(' ');
    if (REST_OF_MIX.test(lowered) || PROJECT_SETTING.test(lowered)) {
        return { kind: 'ignore' };
    }
    const content = tokens.filter((token) => !CONNECTIVE_WORDS.has(token.lower));
    const controls = content.filter((token) => isControl(token.lower)).map((token) => token.lower);
    const position = POSITION.exec(lowered);
    if (position !== null) {
        const leftover = lowered
            .replace(position[0], ' ')
            .split(/\s+/u)
            .filter(
                (word) => word.length > 0 && !CONNECTIVE_WORDS.has(word) && !isControl(word) && !KIND_NOUNS.has(word)
            );
        if (leftover.length === 0) {
            return { kind: 'position', text: position[0].replace(/^the\s+/u, '') };
        }
    }
    const selectionPhrase = content
        .filter((token) => !isControl(token.lower))
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
    if (tokens.some(isBoundToken)) {
        const onlyNames = content.every(
            (token) => isBoundToken(token) || isControl(token.lower) || KIND_NOUNS.has(token.lower)
        );
        return { kind: 'bound', controls, onlyNames };
    }
    const form = readObjectForm(tokens, possessive, objects);
    if (form !== null) {
        return form;
    }
    if (content.length > 0 && content.every((token) => isControl(token.lower))) {
        return { kind: 'controls', controls };
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
type BoundMember = { trackIds: string[]; controls: string[] };
type SlotReading = { unresolved: string[]; selection: SelectionMember[]; bound: BoundMember[] };
type NamedRange = Range & { denotes: ReadonlySet<string> };

function readSlotMembers(input: {
    prompt: string;
    blanked: string;
    masked: string;
    slot: Slot;
    references: readonly NamedRange[];
    context: ProjectContext;
    objects: readonly ProtectableObjectName[];
}): SlotReading {
    const { prompt, blanked, masked, slot, references, context, objects } = input;
    const reading: SlotReading = { unresolved: [], selection: [], bound: [] };
    const trackIds = new Set(context.tracks.map((track) => track.id));
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
        const member = readMember({ tokens, phrase, slot, possessive: raw.some(isPossessiveS), objects });
        if (member.kind === 'unbound' || member.kind === 'position') {
            reading.unresolved.push(member.text);
        } else if (member.kind === 'variant') {
            reading.bound.push({ trackIds: member.trackIds, controls: [] });
        } else if (member.kind === 'bound' && member.onlyNames) {
            const memberReferences = references.filter(
                (reference) => reference.start >= range.start && reference.end <= range.end
            );
            const [only] = memberReferences;
            // A member protects a track only when it names that one track alone: "the Vocals compressor" names a
            // device, and "the return into the Drum Bus" names two objects, one of which it merely routes to.
            const namesOneTrack =
                memberReferences.length === 1 &&
                only !== undefined &&
                Array.from(only.denotes).every((id) => trackIds.has(id));
            if (namesOneTrack) {
                reading.bound.push({ trackIds: Array.from(only.denotes), controls: member.controls });
            }
        } else if (member.kind === 'selection') {
            lastSelection = {
                ...member,
                anaphoric: member.pronoun && member.phrase.toLocaleLowerCase().startsWith('its') && namedBefore,
            };
            reading.selection.push(lastSelection);
            namedBefore ||= tokens.some(isBoundToken);
            continue;
        } else if (member.kind === 'controls' && lastSelection !== null) {
            lastSelection.controls.push(...member.controls);
        }
        if (member.kind !== 'controls') {
            lastSelection = null;
        }
        namedBefore ||= tokens.some(isBoundToken);
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

function normalizeName(name: string): string {
    return name
        .toLocaleLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

/** The tracks, buses and VCA groups a kind form can bind a variant of a name to, by normalized name. */
function readProtectableObjects(context: ProjectContext): ProtectableObjectName[] {
    const tracks = context.tracks.map((track) => ({
        name: normalizeName(track.name),
        kind: track.kind === 'bus' ? ('bus' as const) : ('track' as const),
        trackIds: [track.id],
    }));
    const groups = (context.vcaGroups ?? []).map((group) => ({
        name: normalizeName(group.name),
        kind: 'group' as const,
        trackIds: group.trackIds,
    }));
    return [...tracks, ...groups];
}

function hasSelectedClip(context: ProjectContext): boolean {
    return context.selectedClipId !== null || context.selectedClipIds.length > 0;
}

type Accumulator = {
    unresolved: Set<string>;
    wholeTrackIds: Set<string>;
    namedTrackIds: Set<string>;
    controls: Map<string, Set<string>>;
};

/** The action types a control word names, or undefined when it names none, which makes it the whole track. */
function readControlActions(control: string): readonly string[] | undefined {
    const singular = CONTROL_WORDS.has(control) ? control : control.replace(/s$/u, '');
    if (singular === 'send') {
        return SEND_ACTIONS;
    }
    return refinementRequestReading.operationActions[singular];
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
            const namesOperations =
                member.controls.length > 0 &&
                member.controls.every((control) => readControlActions(control) !== undefined);
            if (protects && namesOperations) {
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
    references: readonly NamedRange[],
    slot: Range,
    vcaGroups: ReadonlyMap<string, readonly string[]>
): string[] {
    return references
        .filter((reference) => reference.start >= slot.start && reference.end <= slot.end)
        .flatMap((reference) => Array.from(reference.denotes).flatMap((id) => vcaGroups.get(id) ?? []));
}

/** The tracks the request names outside every protection slot: what "it" can point at. */
function readTargetTrackIds(
    references: readonly NamedRange[],
    slots: readonly Range[],
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

/** What a bound track name protects: the whole track, or only the operations its controls name. */
function protectBoundMembers(
    bound: readonly BoundMember[],
    found: Accumulator,
    exemptTrackIds: ReadonlySet<string>
): void {
    for (const member of bound) {
        for (const trackId of member.trackIds.filter((id) => !exemptTrackIds.has(id))) {
            protectControls(found, trackId, member.controls);
            if (member.controls.length === 0) {
                found.namedTrackIds.add(trackId);
            }
        }
    }
}

/**
 * Reads every explicit protection clause of the request. A protection that names a project object by
 * an object form and binds to none is reported unresolved; one that binds reports what it keeps: a
 * track by name, the selected track, the request's one named target or a VCA group's members.
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
    const found: Accumulator = {
        unresolved: new Set(),
        wholeTrackIds: new Set(),
        namedTrackIds: new Set(),
        controls: new Map(),
    };
    const slots = protectionSlots.read(masked);
    const objects = readProtectableObjects(context);
    const targetTrackIds = readTargetTrackIds(references, slots, context);
    for (const slot of slots) {
        const reading = readSlotMembers({ prompt, blanked, masked, slot, references, context, objects });
        for (const reference of reading.unresolved) {
            found.unresolved.add(reference);
        }
        readSelectionMembers(reading.selection, { context, targetTrackIds, protects: !slot.exempts }, found);
        if (!slot.exempts) {
            if (slot.strict) {
                // "Leave the Drums alone otherwise" keeps everything but the request's own targets.
                protectBoundMembers(reading.bound, found, slot.otherwise ? targetTrackIds : new Set());
            }
            for (const trackId of readVcaMemberTracks(references, slot, vcaGroups)) {
                found.wholeTrackIds.add(trackId);
            }
        }
    }
    for (const trackId of found.namedTrackIds) {
        found.wholeTrackIds.add(trackId);
    }
    return {
        unresolved: [...found.unresolved],
        protectedTrackIds: [...found.wholeTrackIds],
        namedTrackIds: [...found.namedTrackIds],
        protectedControls: Array.from(found.controls, ([trackId, actions]) => ({ trackId, actionTypes: [...actions] })),
    };
}
