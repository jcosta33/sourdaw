import { type getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../models/ProjectContext';
import { type SemanticCommandListMatch, type SemanticCommandListSelector } from '../../models/SemanticCommandList';

import {
    findAgentReferenceNameSpans,
    type AgentReferenceNameForms,
    type AgentReferenceTextRange,
} from './findAgentReferenceNameSpans';
import { getApplicationProtectedObjects } from './getApplicationProtectedObjects';
import { getBestAgentReferenceNameRanges, type AgentReferenceNamedRange } from './getBestAgentReferenceNameRanges';
import { findTrackControlRestrictionStarts } from './groundingStrategies/findTrackControlRestrictionStarts';
import { getPromptClauses } from './groundingStrategies/getPromptClauses';
import { maskProjectReferences } from './groundingStrategies/maskProjectReferences';
import { maskQuotedLabels } from './groundingStrategies/maskQuotedLabels';
import { resolveClauseActionIntent } from './groundingStrategies/resolveClauseActionIntent';
import { hasExplicitTrackSelection } from './hasExplicitTrackSelection';
import { normalizeAgentReferenceText } from './normalizeAgentReferenceText';
import { resolveAgentReference, type ResolveAgentReferenceInput } from './resolveAgentReference';

/*
 * Compiled target authority (#5295).
 *
 * A compiled command list proves which objects its selectors resolve to, never that the user asked
 * for them. This check closes one hole: a selector that picks an object by a name or id the request
 * never states. Every target the request protects or excludes is refused. What the request states is
 * the shared reference resolver's own reading of it, never a matcher of this file's: the resolver's
 * `naming` mode, which reads an object by its literal id or its whole name, case, diacritics and
 * punctuation folded, its words joined across space and any dash ("hi hat" states Hi-Hat, "Lead-Vox"
 * Lead Vox), and across other punctuation where the name has it there or unless the words before it
 * name another object by themselves and another object's name starts past it ("drums/bus" states
 * Drums Bus beside Drums, "bass/guitar" Bass Guitar beside Guitar, while "Bass & Drums" states no Bass
 * Drums beside Bass and Drums, nor "Bass & Drum Bus" a Bass Drum beside Bass and a Drum Bus), never
 * lengthened by punctuation closing it ("Lead?!" states Lead as closely as Lead?), against every
 * candidate whatever selection the request refers to, and takes the final word of a name in either
 * grammatical number ("the vocal" states Vocals), a form the direct route
 * leaves to its approximate reading. Each stated range names only the objects whose names read it
 * best, so "Vocal" states Vocal and not Vocals, "Café" states Café and not Cafe however either is
 * composed, "Hi–Hat" states Hi-Hat and not Hi Hat, and "Drum Bus" states the bus and not Drum.
 *
 * A selector's whole-name pick and an owner-track pick are stated when that reading names their
 * target or owner track. A name fragment is stated for a target it picks when it occurs as a whole
 * word, in either number, outside every range that states a longer whole name of another object, so
 * "the Drum Bus" states a "Bus" fragment for the Drum Bus and never for the FX Bus, while "the guitars"
 * states a "guitar" fragment for Guitar 2 beside the Guitar track. Once the request names or selects
 * any track, a fragment picks an object a track owns (a device, clip or automation lane) only on one
 * of those tracks, however the request phrases the owner, so "bypass the EQ on Vocals", "bypass the
 * Vocals EQ" and "bypass Vocals' EQ" never state the EQ on Keys, nor "mute the Vocals Verse clip" the
 * Verse clip on Keys; a request naming and selecting no track ("bypass every EQ") leaves the owner
 * open, and so does a selector that also picks by kind, role, role family, tag, device type or
 * condition ("bypass the EQ on Vocals and all MIDI tracks"). The text read is the whole request less
 * its restrictions and the values any call of the batch writes, so an instruction may pick by a name
 * an earlier one states ("turn Vocals down and pan it left"). A selection reference ("this track",
 * "the selected track", "it" or "its" outside every object name for the selected track) that resolves
 * to the picked objects states those picks only when the request names no object of that kind or
 * lists the reference beside one it names ("add an EQ to Vocals and this track"), so "set Vocals
 * volume so it sits better" never stands for the selected Keys, nor "bypass the EQ on Play It".
 *
 * Literal targets, owner-track picks in a request that names and selects no track, and selections
 * by role, role family, kind, device type, tag, condition or no filter at all, are taken as the
 * compiler resolved them, as before this check; so are names the request states beside a negation
 * ("don't touch Keys"). What the request must state for those is left to #5351 and #5353.
 */

type GroundingCatalog = ReturnType<typeof getExecutableAppActionGroundingCatalog>;
type Capability = ResolveAgentReferenceInput['capability'];

/** The selector a compiled call's targets came from, read from the compiler's evidence. */
export type CompiledSelectorTerms = {
    /** The argument the selector resolves; any other target argument of the call is literal. */
    targetArgument?: string;
    where?: SemanticCommandListSelector['where'];
    match?: SemanticCommandListMatch;
};

export type CompiledTargetAuthorityInput = {
    /** The target argument the targets are compiled for. */
    argument: string;
    capability: Capability;
    catalog: GroundingCatalog;
    /** Every id the compiled list's own selectors excluded or protected. */
    compilerExcludedIds: ReadonlySet<string>;
    context: ProjectContext;
    dependencyId?: string;
    /** The whole original request, where protections, exclusions and naming evidence are read. */
    prompt: string;
    /**
     * Set when each target already resolved against the request the way a direct call does; that
     * resolution is the naming evidence, so only the request's protections remain to apply.
     */
    referenceResolved: boolean;
    /** The selector the call's targets came from, absent when the compiler named every one literally. */
    selectorTerms?: CompiledSelectorTerms;
    targetIds: readonly string[];
    /** The text values every call of the batch writes ("Bass Drum" for a rename). */
    valueTexts: readonly string[];
};

export type CompiledTargetAuthority = { status: 'admitted' } | { status: 'refused' };

/**
 * Owned capabilities whose candidates the resolver narrows to a track dependency's objects; it reads
 * no dependency for a clip or an automation lane, so their whole names are read against the owner
 * the request qualifies or selects alone.
 */
const TRACK_DEPENDENT_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
    'device',
    'sidechain-capable-device',
]);

/** A request states a name in its ordinary forms: "the vocal" states Vocals. */
const NAME_FORMS: AgentReferenceNameForms = 'with-number-forms';

const ADMITTED: CompiledTargetAuthority = { status: 'admitted' };
const UNAUTHORIZED: CompiledTargetAuthority = { status: 'refused' };

/**
 * The shared resolver's reading of what the text names by literal id or whole name, and the ranges
 * of the text that state each whole name, as the resolver's own best-reading rule keeps them.
 */
function readNaming(
    text: string,
    capability: Capability,
    context: ProjectContext,
    dependencyId?: string
): { ids: string[]; nameRanges: AgentReferenceNamedRange[] } {
    const named = resolveAgentReference({
        prompt: text,
        assertedId: undefined,
        capability,
        context,
        dependencyId,
        naming: NAME_FORMS,
    }).candidates.filter((candidate) =>
        candidate.evidence.some((evidence) => evidence === 'literal-id' || evidence === 'exact-name')
    );
    const namedByName = named.filter((candidate) => candidate.evidence.includes('exact-name'));
    return {
        ids: named.map((candidate) => candidate.id),
        nameRanges: getBestAgentReferenceNameRanges(text, namedByName, NAME_FORMS),
    };
}

function readStatedIds(text: string, capability: Capability, context: ProjectContext, dependencyId?: string) {
    return readNaming(text, capability, context, dependencyId).ids;
}

/** Objects of the capability the text names by literal id or whole name, or refers to as the selection. */
function readReferencedIds(
    text: string,
    capability: Capability,
    context: ProjectContext,
    dependencyId?: string
): string[] {
    const selectedIds = resolveAgentReference({
        prompt: text,
        assertedId: undefined,
        capability,
        context,
        dependencyId,
    })
        .candidates.filter((candidate) => candidate.evidence.includes('selection'))
        .map((candidate) => candidate.id);
    return [...new Set([...readStatedIds(text, capability, context, dependencyId), ...selectedIds])];
}

type ReferenceReader = (
    text: string,
    capability: Capability,
    context: ProjectContext,
    dependencyId?: string
) => string[];

/**
 * The objects the reader finds in the text, reading an owned object against every track the text
 * names as well, so "the EQ on Vocals and the EQ on Keys" names both EQs although no single owner
 * holds them.
 */
function readWithNamedOwners(
    read: ReferenceReader,
    text: string,
    capability: Capability,
    context: ProjectContext,
    dependencyId?: string
): string[] {
    const named = read(text, capability, context, dependencyId);
    if (dependencyId !== undefined || !TRACK_DEPENDENT_CAPABILITIES.has(capability)) {
        return named;
    }
    const ownedByNamedTracks = read(text, 'track', context).flatMap((trackId) =>
        read(text, capability, context, trackId)
    );
    return [...new Set([...named, ...ownedByNamedTracks])];
}

/** Every object the track owns: its devices, its clips and its automation lanes. */
function getTrackOwnedObjectIds(trackId: string, context: ProjectContext): string[] {
    const laneIds = (context.automationLanes ?? []).filter((lane) => lane.trackId === trackId).map((lane) => lane.id);
    const track = context.tracks.find((candidate) => candidate.id === trackId);
    if (track === undefined) {
        return laneIds;
    }
    return [...track.devices.map((device) => device.id), ...track.clips.map((clip) => clip.id), ...laneIds];
}

function isTrackOwned(id: string, context: ProjectContext): boolean {
    return context.tracks.some((track) => getTrackOwnedObjectIds(track.id, context).includes(id));
}

/** The name of every object in the project, which a value or fragment read in the text never runs into. */
function getProjectObjectNames(context: ProjectContext): string[] {
    const trackNames = context.tracks.flatMap((track) => [
        track.name,
        ...track.clips.map((clip) => clip.name),
        ...track.devices.flatMap((device) => (device.name === undefined ? [] : [device.name])),
    ]);
    const laneNames = (context.automationLanes ?? []).map((lane) => lane.name);
    const layerNames = (context.adjustmentLayers ?? []).map((layer) => layer.name);
    return [...trackNames, ...laneNames, ...layerNames];
}

/** "that track" points at a track as "this track" does, though the shared reading takes only the latter. */
const DEMONSTRATIVE_TRACK_REFERENCE = /\bthat (?:audio |midi |bus |folder )?track\b/u;

/** "it" or "its", which may stand for the selected track. */
const SELECTION_PRONOUN = /\bits?\b/iu;

/** A phrase that may stand for the selection: "this track", "the selected track", "the current track", "it" or "its". */
const SELECTION_REFERENCE =
    /\b(?:this|(?:the\s+)?(?:selected|current))(?:\s+(?:audio|midi|bus|folder))?\s+track\b|\bits?\b/giu;

/**
 * What lies between two members of one list, past any punctuation closing the first: a comma, "and",
 * "or" or "also", with the preposition and article a member may repeat ("Vocals, and also to it", "this
 * track and on Vocals").
 */
const LIST_JOINER = /^[\s,)\]"'’”]*(?:(?:and|or)\s+)?(?:also\s+)?(?:(?:to|on|for|in|of)\s+)?(?:the\s+)?$/iu;
const LIST_CONJUNCTION = /,|\b(?:and|or|also)\b/iu;

function joinsAsListMembers(between: string): boolean {
    return LIST_JOINER.test(between) && LIST_CONJUNCTION.test(between);
}

/** The text with every range stating the name of an object in the project blanked out. */
function maskObjectNames(text: string, context: ProjectContext): string {
    const names = getProjectObjectNames(context);
    return names.flatMap((name) => findAgentReferenceNameSpans(text, name, NAME_FORMS, names)).reduce(blankRange, text);
}

/** Whether "it" or "its" occurs outside every object name: "Play It" names a track, not the selection. */
function mentionsSelectionPronoun(text: string, context: ProjectContext): boolean {
    return SELECTION_PRONOUN.test(maskObjectNames(text, context));
}

/**
 * Whether a selection reference outside every object name is listed beside a name of the capability
 * the text states: "Kick (In) and this track", "Vocals, and also to it", never "Vocals so it sits
 * better" or "Vocals to match this track".
 */
function listsSelectionBesideName(text: string, capability: Capability, context: ProjectContext): boolean {
    const { nameRanges } = readNaming(text, capability, context);
    return Array.from(maskObjectNames(text, context).matchAll(SELECTION_REFERENCE)).some((reference) => {
        const start = reference.index;
        const end = start + reference[0].length;
        return nameRanges.some((name) =>
            joinsAsListMembers(name.end <= start ? text.slice(name.end, start) : text.slice(end, name.start))
        );
    });
}

/**
 * Whether the text's selection reference may stand for the selection: when the text names no object
 * of the capability, or lists the reference beside one it names.
 */
function readsSelectionReference(text: string, capability: Capability, context: ProjectContext): boolean {
    return !namesObjectByName(text, capability, context) || listsSelectionBesideName(text, capability, context);
}

/**
 * Whether the text refers to the selected track: "this track", "the selected track" or "that track"
 * whatever is selected, or "it" or "its" outside every object name while a track is selected, when the
 * text names no track or lists the pronoun beside one ("bypass the EQ on Vocals so it sounds clearer"
 * refers to Vocals alone).
 */
function refersToSelectedTrack(text: string, context: ProjectContext): boolean {
    if (hasExplicitTrackSelection(text) || DEMONSTRATIVE_TRACK_REFERENCE.test(normalizeAgentReferenceText(text))) {
        return true;
    }
    return (
        context.selectedTrackId !== null &&
        mentionsSelectionPronoun(text, context) &&
        readsSelectionReference(text, 'track', context)
    );
}

/**
 * Whether every predicate of the selector's match is a name fragment. One that also picks by kind,
 * role, role family, tag, device type or condition ("the EQ on Vocals and all MIDI tracks") reaches
 * owners the request selects by those, so its owners are taken as the compiler resolved them.
 */
function picksByNameAlone(terms: CompiledSelectorTerms | undefined): boolean {
    const predicates = [terms?.match?.all, terms?.match?.any].flatMap((list) => list ?? []);
    return predicates.every((predicate) => 'nameIncludes' in predicate);
}

/**
 * The track-owned objects the text can refer to: every object on a track the text names, by whole
 * name or id in any phrasing ("the Vocals EQ", "the EQ of Vocals", "Vocals' EQ", "the EQ on Vocals"),
 * and on the selected track when the text refers to it. Null when a dependency already fixes the owner,
 * when the selector also picks by something other than a name fragment, or when the text names and
 * selects no track, which leaves every owner open.
 */
function readReachableOwnedIds(text: string, input: CompiledTargetAuthorityInput): ReadonlySet<string> | null {
    const { context, dependencyId } = input;
    if (dependencyId !== undefined || !picksByNameAlone(input.selectorTerms)) {
        return null;
    }
    const namedTrackIds = readStatedIds(text, 'track', context);
    const selectsTrack = refersToSelectedTrack(text, context);
    if (namedTrackIds.length === 0 && !selectsTrack) {
        return null;
    }
    const selectedTrackIds = selectsTrack && context.selectedTrackId !== null ? [context.selectedTrackId] : [];
    return new Set(
        [...namedTrackIds, ...selectedTrackIds].flatMap((trackId) => getTrackOwnedObjectIds(trackId, context))
    );
}

type MaskedRequest = { prompt: string; maskedPrompt: string; clauses: ReturnType<typeof getPromptClauses> };

function maskRequest(prompt: string, context: ProjectContext): MaskedRequest {
    const maskedPrompt = maskQuotedLabels(maskProjectReferences(prompt, context));
    return { prompt, maskedPrompt, clauses: getPromptClauses(prompt, maskedPrompt) };
}

/**
 * Where the instruction starting at `start` ends: past every following clause that continues it
 * rather than giving another instruction, up to the end of its sentence. "add a compressor to
 * Vocals and Bass" runs whole, "leave Keys alone and set Drums to 50%" stops at the second
 * instruction.
 */
function getInstructionEnd(request: MaskedRequest, start: number, catalog: GroundingCatalog): number {
    const sentenceEnd = /[;!?\n]|\.(?!\d)/u.exec(request.maskedPrompt.slice(start));
    const limit = sentenceEnd === null ? request.prompt.length : start + sentenceEnd.index;
    const nextInstruction = request.clauses.find(
        (clause) =>
            clause.start > start && clause.start < limit && resolveClauseActionIntent(clause.masked, catalog) !== null
    );
    return nextInstruction?.start ?? limit;
}

/** Every restriction of the whole request, from its restriction phrase to the end of its instruction. */
function getRestrictionRanges(request: MaskedRequest, catalog: GroundingCatalog): AgentReferenceTextRange[] {
    return findTrackControlRestrictionStarts(request.maskedPrompt).map((start) => ({
        start,
        end: getInstructionEnd(request, start, catalog),
    }));
}

function blankRange(text: string, { start, end }: AgentReferenceTextRange): string {
    return `${text.slice(0, start)}${' '.repeat(end - start)}${text.slice(end)}`;
}

/**
 * The text with the last occurrence of each written value blanked out: the value ("rename Kick to
 * Bass Drum") follows the target it is written to, and "rename Kick to Kick In" keeps the earlier
 * mention of the target.
 */
function maskWrittenValues(text: string, values: readonly string[], context: ProjectContext): string {
    const objectNames = getProjectObjectNames(context);
    return values.reduce((masked, value) => {
        const last = findAgentReferenceNameSpans(masked, value, NAME_FORMS, objectNames).at(-1);
        return last === undefined ? masked : blankRange(masked, last);
    }, text);
}

/** Everything the request protects or excludes, with every object on a protected track. */
function getProtectedIds(
    input: CompiledTargetAuthorityInput,
    request: MaskedRequest,
    restrictionRanges: readonly AgentReferenceTextRange[]
): Set<string> {
    const protectedIds = new Set(input.compilerExcludedIds);
    for (const object of getApplicationProtectedObjects({
        actions: [],
        context: input.context,
        prompt: input.prompt,
    })) {
        protectedIds.add(object.id);
    }
    for (const range of restrictionRanges) {
        const restriction = request.prompt.slice(range.start, range.end);
        const { capability, context, dependencyId } = input;
        for (const id of readWithNamedOwners(readReferencedIds, restriction, capability, context, dependencyId)) {
            protectedIds.add(id);
        }
        // "leave Bass Verse unchanged" protects the clip, not every object on a track named Bass.
        const trackRestriction = readNaming(restriction, capability, context, dependencyId).nameRanges.reduce(
            blankRange,
            restriction
        );
        for (const trackId of readReferencedIds(trackRestriction, 'track', context)) {
            protectedIds.add(trackId);
            for (const ownedId of getTrackOwnedObjectIds(trackId, context)) {
                protectedIds.add(ownedId);
            }
        }
    }
    return protectedIds;
}

/**
 * The text the targets are read from: the whole request, so a later instruction may pick by a name
 * an earlier one states ("mute Vocals and bypass the EQ on it"), with its restrictions and the values
 * the batch writes blanked, so a name stated only to protect an object or as a new name is never
 * read as picking a target.
 */
function getEvidenceText(
    input: CompiledTargetAuthorityInput,
    request: MaskedRequest,
    restrictionRanges: readonly AgentReferenceTextRange[]
): string {
    const unrestricted = restrictionRanges.reduce(blankRange, request.prompt);
    return maskWrittenValues(unrestricted, input.valueTexts, input.context);
}

/** The whole names, name fragments and owner tracks a selector picks its targets by. */
type NamePicks = { names: string[]; fragments: string[]; trackIds: string[] };

function getNamePicks(input: CompiledTargetAuthorityInput): NamePicks {
    const picks: NamePicks = { names: [], fragments: [], trackIds: [] };
    const terms = input.selectorTerms;
    // A literal target is not a selector pick; it is admitted as the compiler resolved it.
    if (terms === undefined || terms.targetArgument !== input.argument) {
        return picks;
    }
    if (terms.where?.name !== undefined) {
        picks.names.push(terms.where.name);
    }
    if (terms.where?.trackId !== undefined) {
        picks.trackIds.push(terms.where.trackId);
    }
    const predicates = [terms.match?.all, terms.match?.any].flatMap((list) => list ?? []);
    for (const predicate of predicates) {
        if ('nameIncludes' in predicate) {
            picks.fragments.push(predicate.nameIncludes);
        }
    }
    return picks;
}

/** The name a `nameIncludes` predicate reads for the object, as the compiler's candidates carry it. */
function getObjectName(id: string, context: ProjectContext): string | undefined {
    for (const track of context.tracks) {
        if (track.id === id) {
            return track.name;
        }
        const owned = [...track.clips, ...track.devices].find((object) => object.id === id);
        if (owned !== undefined) {
            return owned.name;
        }
    }
    const lane = context.automationLanes?.find((candidate) => candidate.id === id);
    if (lane !== undefined) {
        return lane.name;
    }
    return context.adjustmentLayers?.find((candidate) => candidate.id === id)?.name;
}

/** Whether the range reaches past the inner range on either side while covering all of it. */
function extendsBeyond(range: AgentReferenceTextRange, inner: AgentReferenceTextRange): boolean {
    const covers = range.start <= inner.start && inner.end <= range.end;
    return covers && (range.start < inner.start || inner.end < range.end);
}

/**
 * Whether the text states the fragment for every target it picks: as a whole word, in either number,
 * somewhere no range states a longer whole name of another object, so "Bus" inside "the Drum Bus"
 * states the Drum Bus and never the FX Bus. A whole name read no further than the fragment leaves it
 * standing: "the guitars" states the Guitar track and the "guitar" fragment for Guitar 2 alike. A
 * target a track owns must also sit on a track the text names or selects, when it names or selects
 * any, so "the Vocals EQ" never states the EQ on Keys, nor "the Verse clip on Vocals" the Verse clip
 * on Keys.
 */
function statesFragment(
    text: string,
    fragment: string,
    input: CompiledTargetAuthorityInput,
    nameRanges: readonly AgentReferenceNamedRange[],
    reachableIds: ReadonlySet<string> | null
): boolean {
    const occurrences = findAgentReferenceNameSpans(text, fragment, NAME_FORMS, getProjectObjectNames(input.context));
    const pickedIds = input.targetIds.filter((targetId) => {
        const name = getObjectName(targetId, input.context);
        return name === undefined || name.toLowerCase().includes(fragment.toLowerCase());
    });
    return pickedIds.every(
        (targetId) =>
            (reachableIds === null || !isTrackOwned(targetId, input.context) || reachableIds.has(targetId)) &&
            occurrences.some((occurrence) =>
                nameRanges.every((nameRange) => nameRange.id === targetId || !extendsBeyond(nameRange, occurrence))
            )
    );
}

/** Whether the text states every whole name and fragment the selector picks its targets by. */
function statesNamePicks(text: string, picks: NamePicks, input: CompiledTargetAuthorityInput): boolean {
    const { capability, context, dependencyId } = input;
    if (picks.names.length > 0) {
        const statedIds = readWithNamedOwners(readStatedIds, text, capability, context, dependencyId);
        if (!input.targetIds.every((targetId) => statedIds.includes(targetId))) {
            return false;
        }
    }
    const { nameRanges } = readNaming(text, capability, context, dependencyId);
    const reachableIds = readReachableOwnedIds(text, input);
    return picks.fragments.every((fragment) => statesFragment(text, fragment, input, nameRanges, reachableIds));
}

/**
 * Whether the request's selection reference is the object: "this track" or "the selected track"
 * through the direct route's selection reading, or "it" or "its" outside every object name for the
 * selected track.
 */
function selectsObject(text: string, objectId: string, capability: Capability, context: ProjectContext): boolean {
    if (objectId === context.selectedTrackId && mentionsSelectionPronoun(text, context)) {
        return true;
    }
    const result = resolveAgentReference({ prompt: text, assertedId: objectId, capability, context });
    return result.status === 'resolved' && result.evidence === 'selection';
}

/** Whether the text names an object of the capability by its literal id or whole name rather than through a selection. */
function namesObjectByName(text: string, capability: Capability, context: ProjectContext): boolean {
    return readNaming(text, capability, context).ids.length > 0;
}

/**
 * Whether the request's selection reference stands for every target, which states any name the
 * selector picks them by; once the request names an object of that kind, it stands for nothing unless
 * the request lists it beside that name ("add an EQ to Vocals and this track").
 */
function selectsEveryTarget(text: string, input: CompiledTargetAuthorityInput): boolean {
    return (
        readsSelectionReference(text, input.capability, input.context) &&
        input.targetIds.every((targetId) => selectsObject(text, targetId, input.capability, input.context))
    );
}

/** Whether the request names a track or refers to the selected one, which an owner-track pick must answer to. */
function refersToAnyTrack(text: string, context: ProjectContext): boolean {
    const selectedTrackId = context.selectedTrackId;
    return (
        namesObjectByName(text, 'track', context) ||
        (selectedTrackId !== null && selectsObject(text, selectedTrackId, 'track', context))
    );
}

/**
 * Whether the request states the owner track by its whole name or id, or selects it without naming a
 * track or in a list beside one it names ("bypass the EQ on Vocals and on this track").
 */
function statesTrack(text: string, trackId: string, context: ProjectContext): boolean {
    if (readStatedIds(text, 'track', context).includes(trackId)) {
        return true;
    }
    return readsSelectionReference(text, 'track', context) && selectsObject(text, trackId, 'track', context);
}

/** Whether the request authorizes every target a compiled list resolved for one argument. */
export function admitsCompiledTargets(input: CompiledTargetAuthorityInput): CompiledTargetAuthority {
    const request = maskRequest(input.prompt, input.context);
    const restrictionRanges = getRestrictionRanges(request, input.catalog);
    const protectedIds = getProtectedIds(input, request, restrictionRanges);
    if (input.targetIds.some((targetId) => protectedIds.has(targetId))) {
        return UNAUTHORIZED;
    }
    if (input.referenceResolved) {
        return ADMITTED;
    }
    const picks = getNamePicks(input);
    if (picks.names.length === 0 && picks.fragments.length === 0 && picks.trackIds.length === 0) {
        return ADMITTED;
    }
    const text = getEvidenceText(input, request, restrictionRanges);
    const statesSelectorNames = statesNamePicks(text, picks, input) || selectsEveryTarget(text, input);
    const statesTrackPicks =
        picks.trackIds.every((trackId) => statesTrack(text, trackId, input.context)) ||
        !refersToAnyTrack(text, input.context);
    return statesSelectorNames && statesTrackPicks ? ADMITTED : UNAUTHORIZED;
}
