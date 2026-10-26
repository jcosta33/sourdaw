import { type ProjectContext } from '../../models/ProjectContext';
import { scanPromptQuotedText } from '../../transformers/promptParser/promptQuotedText';

import {
    CONNECTIVE_WORDS,
    KIND_NOUNS,
    PROJECT_SETTING,
    REST_OF_MIX,
    SEND_ACTIONS,
    CONTROL_WORDS,
    TRACK_KIND_NOUNS,
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
    /** Fully consumed, resolved track/control clauses; every other original span still belongs to the clip reader. */
    resolvedTrackClauses: Range[];
    /** Every reference of a protection that names a project object by one of the object forms and binds to none. */
    unresolved: string[];
    /** Tracks a protection leaves wholly alone: bound by name, through the selection, or as a VCA group's members. */
    protectedTrackIds: string[];
    /** The part of `protectedTrackIds` a protection names by track name alone. */
    namedTrackIds: string[];
    /** Tracks a protection leaves alone only through the operations it names ("keep its pan as is"). */
    protectedControls: Array<{
        trackId: string;
        actionTypes: string[];
        /** Every operation except these is protected when present. */
        exceptActionTypes?: string[];
    }>;
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
const RESERVED_SELECTION = new RegExp(
    `\\b(?:${[...SELECTION_PHRASES.keys()].toSorted((left, right) => right.length - left.length).join('|')})\\b`,
    'giu'
);
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
    const position = slot.strict ? POSITION.exec(lowered) : null;
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
        // "the Drums clip" or "the Drums plugin" names an object on the track, never the track itself.
        const onlyNames = content.every(
            (token) => isBoundToken(token) || isControl(token.lower) || TRACK_KIND_NOUNS.has(token.lower)
        );
        return { kind: 'bound', controls, onlyNames };
    }
    // An object form names a project object only in a closed protection: "keep the Kick level punchy" protects nothing.
    const form = slot.strict ? readObjectForm(tokens, possessive, objects) : null;
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
type SlotReading = {
    complete: boolean;
    uniqueTrackOwners: boolean;
    unreadContinuations: Range[];
    unresolved: string[];
    selection: SelectionMember[];
    bound: BoundMember[];
    /** Controls the slot lists with no owner ("except for the fader"). */
    controls: string[];
};
type MemberRange = Range & { afterThen: boolean; resetsOwner: boolean };
type SlotMemberState = {
    reading: SlotReading;
    namedBefore: boolean;
    pendingControls: string[];
    lastOwner: { controls: string[] } | null;
};
type NamedRange = Range & { denotes: ReadonlySet<string> };

/** Whether every token belongs to one track owner and its controls, or to a control waiting for its owner. */
function fullyStatesTrackMember(tokens: readonly Token[]): boolean {
    const words = tokens
        .map((token) => token.lower)
        .filter((word) => word !== 'the' && word !== 'my' && word !== 'your' && word !== 'our');
    const owner = (parts: readonly string[]) => {
        const [first, ...rest] = parts;
        return (
            SELECTION_PHRASES.has(parts.join(' ')) ||
            (first !== undefined && first.includes('□') && rest.every((word) => TRACK_KIND_NOUNS.has(word)))
        );
    };
    const ofIndex = words.findIndex((word) => word === 'of' || word === 'on');
    if (ofIndex >= 0) {
        return ofIndex > 0 && words.slice(0, ofIndex).every(isControl) && owner(words.slice(ofIndex + 1));
    }
    const trailingControl = words.findLastIndex((word) => !isControl(word));
    return words.length > 0 && (words.every(isControl) || owner(words.slice(0, trailingControl + 1)));
}

/** Track candidates named in full, with mixed object candidates kept outside consumed track-only spans. */
function readBoundTrackMember(
    member: MemberReading,
    references: readonly NamedRange[],
    range: Range,
    trackIds: ReadonlySet<string>
): { member: BoundMember; complete: boolean; uniqueOwner: boolean } | null {
    if (member.kind !== 'bound' || !member.onlyNames) {
        return null;
    }
    const memberReferences = references.filter(
        (reference) => reference.start >= range.start && reference.end <= range.end
    );
    const [only] = memberReferences;
    // Separate references do not establish one owner: a named device or a route destination must
    // not buy track authority. One shared name conservatively keeps every track candidate it denotes.
    if (memberReferences.length !== 1 || only === undefined) {
        return null;
    }
    const owners = Array.from(only.denotes).filter((id) => trackIds.has(id));
    if (owners.length === 0) {
        return null;
    }
    return {
        member: { trackIds: owners, controls: [...member.controls] },
        complete: owners.length === only.denotes.size,
        uniqueOwner: only.denotes.size === 1,
    };
}

/** Split the original UTF16 slot at list members, retaining then boundaries that reset control ownership. */
function readMemberRanges(masked: string, slot: Slot): MemberRange[] {
    const separators = [
        ...Array.from(masked.slice(slot.start, slot.end).matchAll(MEMBER_SEPARATOR), (separator) => ({
            start: slot.start + separator.index,
            end: slot.start + separator.index + separator[0].length,
            continues: false,
        })),
        ...slot.memberSeparators
            .filter((separator) => separator.start >= slot.start && separator.end <= slot.end)
            .map((separator) => ({ ...separator, continues: true })),
    ].toSorted((left, right) => left.start - right.start);
    const bounds: MemberRange[] = [];
    let start = slot.start;
    let afterThen = false;
    let resetsOwner = false;
    for (const separator of separators) {
        bounds.push({ start, end: separator.start, afterThen, resetsOwner });
        start = separator.end;
        afterThen ||= separator.continues;
        resetsOwner = separator.continues;
    }
    bounds.push({ start, end: slot.end, afterThen, resetsOwner });
    return bounds;
}

function parseSlotMember(input: {
    prompt: string;
    blanked: string;
    masked: string;
    slot: Slot;
    range: MemberRange;
    objects: readonly ProtectableObjectName[];
}): { member: MemberReading; tokens: Token[]; complete: boolean } {
    const { prompt, blanked, masked, slot, range, objects } = input;
    const raw = readTokens(blanked, masked, range);
    const isPossessiveS = (token: Token, index: number) => token.lower === 's' && index > 0;
    const tokens = raw.filter((token, index) => !isPossessiveS(token, index));
    const phrase = prompt.slice(range.start, range.end).trim();
    // A contained match cannot discharge an explicitly quoted owner such as the missing "Bass Amp".
    const incompleteQuotedOwner = raw.some((token) => token.quoted && !isBoundToken(token));
    const original = readTokens(prompt, masked, range).filter((token, index) => !isPossessiveS(token, index));
    const unboundOwner =
        slot.strict && incompleteQuotedOwner ? readObjectForm(original, raw.some(isPossessiveS), objects) : null;
    const member = unboundOwner ?? readMember({ tokens, phrase, slot, possessive: raw.some(isPossessiveS), objects });
    return { member, tokens, complete: fullyStatesTrackMember(tokens) };
}

/** Attach one member to its owner, keeping unresolved continuation spans out of track-only evidence. */
function applySlotMember(
    state: SlotMemberState,
    range: MemberRange,
    parsed: ReturnType<typeof parseSlotMember>,
    references: readonly NamedRange[],
    trackIds: ReadonlySet<string>
): void {
    const { member, tokens, complete } = parsed;
    state.reading.complete &&= complete;
    if (range.afterThen && !complete && member.kind !== 'variant') {
        state.reading.unreadContinuations.push({ start: range.start, end: range.end });
        if (member.kind === 'unbound' || member.kind === 'position') {
            state.reading.unresolved.push(member.text);
        }
        return;
    }
    if (member.kind === 'controls') {
        if (state.lastOwner === null) {
            state.pendingControls.push(...member.controls);
        } else {
            state.lastOwner.controls.push(...member.controls);
        }
    } else if (member.kind === 'selection') {
        const selection = {
            ...member,
            anaphoric: member.pronoun && member.phrase.toLocaleLowerCase().startsWith('its') && state.namedBefore,
        };
        state.reading.selection.push(selection);
        state.lastOwner = adoptControls(selection, state.pendingControls);
        state.pendingControls = [];
    } else {
        const pending = state.pendingControls;
        state.pendingControls = [];
        state.lastOwner = null;
        if (member.kind === 'unbound' || member.kind === 'position') {
            state.reading.unresolved.push(member.text);
        } else if (member.kind === 'variant') {
            state.reading.bound.push({ trackIds: member.trackIds, controls: [] });
        } else {
            const owner = readBoundTrackMember(member, references, range, trackIds);
            state.reading.complete &&= owner !== null && owner.complete;
            if (owner !== null) {
                state.reading.uniqueTrackOwners &&= owner.uniqueOwner;
                state.reading.bound.push(owner.member);
                state.lastOwner = adoptControls(owner.member, pending);
            }
        }
    }
    state.namedBefore ||= tokens.some(isBoundToken);
}

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
    const reading: SlotReading = {
        complete: true,
        uniqueTrackOwners: true,
        unreadContinuations: [],
        unresolved: [],
        selection: [],
        bound: [],
        controls: [],
    };
    const trackIds = new Set(context.tracks.map((track) => track.id));
    const bounds = readMemberRanges(masked, slot);
    // Controls listed before their owner ("the fader and pan of Vocals") wait for it; ones after an owner that
    // names a control ("the Vocals pan and fader") join it. An owner protected whole never narrows to them.
    const state: SlotMemberState = { reading, namedBefore: false, pendingControls: [], lastOwner: null };
    for (const range of bounds) {
        if (range.resetsOwner) {
            reading.complete &&= state.pendingControls.length === 0;
            state.pendingControls = [];
            state.lastOwner = null;
        }
        const parsed = parseSlotMember({ prompt, blanked, masked, slot, range, objects });
        applySlotMember(state, range, parsed, references, trackIds);
    }
    if (slot.memberSeparators.length > 0 && state.pendingControls.length > 0) {
        reading.complete = false;
    }
    reading.controls.push(...state.pendingControls);
    return reading;
}

/** Gives an owner naming a control the controls listed before it, and returns it when later controls may join it. */
function adoptControls<Owner extends { controls: string[] }>(owner: Owner, pending: readonly string[]): Owner | null {
    if (owner.controls.length === 0) {
        return null;
    }
    owner.controls.unshift(...pending);
    return owner;
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
    complements: Array<{ trackId: string; actionTypes: string[]; exceptActionTypes: string[] }>;
};

function createAccumulator(): Accumulator {
    return {
        unresolved: new Set(),
        wholeTrackIds: new Set(),
        namedTrackIds: new Set(),
        controls: new Map(),
        complements: [],
    };
}

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
    vcaGroups: ReadonlyMap<string, readonly string[]>,
    unreadContinuations: readonly Range[]
): string[] {
    return references
        .filter(
            (reference) =>
                reference.start >= slot.start &&
                reference.end <= slot.end &&
                !unreadContinuations.some((range) => reference.start < range.end && reference.end > range.start)
        )
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

/** Keeps the whole object except for the operations a following control carve-out explicitly permits. */
function exemptControls(found: Accumulator, trackIds: readonly string[], carvedOut: readonly string[]): void {
    const exempted = [...new Set(carvedOut.flatMap((control) => readControlActions(control) ?? []))];
    if (exempted.length === 0) {
        return;
    }
    for (const trackId of trackIds) {
        found.wholeTrackIds.delete(trackId);
        found.namedTrackIds.delete(trackId);
        found.complements.push({ trackId, actionTypes: [], exceptActionTypes: exempted });
    }
}

/**
 * Reads every explicit protection clause of the request. A protection that names a project object by
 * an object form and binds to none is reported unresolved; one that binds reports what it keeps: a
 * track by name, the selected track, the request's one named target or a VCA group's members.
 * Requiring unique owners withholds only consumed spans; conservative protection facts stay intact.
 */
export function readExplicitProtections(
    prompt: string,
    context: ProjectContext,
    options: { requireUniqueTrackOwners?: boolean } = {}
): ProtectionReading {
    const candidates = [...refinementRequestReading.candidates(context), ...getExtraCandidates(context)];
    const scanned = scanPromptQuotedText(prompt).maskedText;
    const reservedSelections = Array.from(scanned.matchAll(RESERVED_SELECTION), (match) => ({
        start: match.index,
        end: match.index + match[0].length,
    }));
    const references = refinementRequestReading
        .references(prompt, candidates)
        .filter(
            (reference) =>
                !reservedSelections.some(
                    (selection) => reference.start < selection.end && reference.end > selection.start
                )
        );
    const blanked = blankRanges(prompt, references);
    // Every scanner span and string slice uses UTF16 offsets, including the two units of an astral character.
    const masked = blanked
        .split('')
        .map((character, index) => (scanned[index] === prompt[index] ? character : ' '))
        .join('');
    const vcaGroups = new Map((context.vcaGroups ?? []).map((group) => [group.id, group.trackIds]));
    // Keep each protection separate until its own carve-out is read, so it cannot relax an earlier clause.
    const readings: Accumulator[] = [];
    const resolvedTrackClauses: Range[] = [];
    let found = createAccumulator();
    const slots = protectionSlots.read(masked);
    const objects = readProtectableObjects(context);
    const targetTrackIds = readTargetTrackIds(references, slots, context);
    let wholeBeforeCarveOut: string[] = [];
    for (const slot of slots) {
        if (!slot.exempts) {
            found = createAccumulator();
            readings.push(found);
        }
        const reading = readSlotMembers({ prompt, blanked, masked, slot, references, context, objects });
        for (const reference of reading.unresolved) {
            found.unresolved.add(reference);
        }
        readSelectionMembers(reading.selection, { context, targetTrackIds, protects: !slot.exempts }, found);
        const carvesOutTrack = slot.exempts && wholeBeforeCarveOut.length > 0 && reading.controls.length > 0;
        if (slot.exempts) {
            exemptControls(found, wholeBeforeCarveOut, reading.controls);
        }
        wholeBeforeCarveOut = [];
        if (!slot.exempts) {
            if (slot.strict) {
                // "Leave the Drums alone otherwise" keeps everything but the request's own targets.
                const exempt = slot.otherwise ? targetTrackIds : new Set<string>();
                protectBoundMembers(reading.bound, found, exempt);
                for (const trackId of readVcaMemberTracks(references, slot, vcaGroups, reading.unreadContinuations)) {
                    found.wholeTrackIds.add(trackId);
                }
                wholeBeforeCarveOut = [...found.wholeTrackIds];
            }
        }
        const resolvesOwner = found.wholeTrackIds.size > 0 || found.controls.size > 0 || carvesOutTrack;
        if (
            slot.completeRange !== null &&
            reading.complete &&
            (!options.requireUniqueTrackOwners || reading.uniqueTrackOwners) &&
            reading.unresolved.length === 0 &&
            resolvesOwner &&
            (reading.controls.length === 0 || carvesOutTrack)
        ) {
            resolvedTrackClauses.push(slot.completeRange);
        }
    }
    return {
        resolvedTrackClauses,
        unresolved: [...new Set(readings.flatMap((reading) => [...reading.unresolved]))],
        protectedTrackIds: [
            ...new Set(readings.flatMap((reading) => [...reading.wholeTrackIds, ...reading.namedTrackIds])),
        ],
        namedTrackIds: [...new Set(readings.flatMap((reading) => [...reading.namedTrackIds]))],
        protectedControls: readings.flatMap((reading) => [
            ...Array.from(reading.controls, ([trackId, actions]) => ({ trackId, actionTypes: [...actions] })),
            ...reading.complements,
        ]),
    };
}
