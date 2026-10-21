import { type getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../models/ProjectContext';
import { type SemanticCommandListMatch, type SemanticCommandListSelector } from '../../models/SemanticCommandList';

import { getApplicationProtectedObjects } from './getApplicationProtectedObjects';
import { escapeRegExp } from './groundingStrategies/escapeRegExp';
import { findTrackControlRestrictionStarts } from './groundingStrategies/findTrackControlRestrictionStarts';
import { getPromptClauses } from './groundingStrategies/getPromptClauses';
import { maskProjectReferences } from './groundingStrategies/maskProjectReferences';
import { maskQuotedLabels } from './groundingStrategies/maskQuotedLabels';
import { resolveClauseActionIntent } from './groundingStrategies/resolveClauseActionIntent';
import { resolveAgentReference, type ResolveAgentReferenceInput } from './resolveAgentReference';

/*
 * Compiled target authority (#5295).
 *
 * A compiled command list proves which objects its selectors resolve to, never that the user asked
 * for them. This check closes one hole: a selector, or a literal target, that picks an object by
 * name or id the request never states. Every target the request protects or excludes is refused.
 * Every name, name fragment, owner track or literal id a target is picked by must be stated in the
 * clause's original text (outside its protections and the values the batch writes), or, for an id,
 * reached by the clause's selection reference ("the selected track"). A single target picked that
 * way must also be the one the clause grounds when the direct route reads it.
 *
 * Selections by role, role family, kind, device type, tag, condition or no filter at all are taken
 * as the compiler resolved them, as before this check. What the request must state for those is
 * left to #5351 and #5353.
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
    /** Where the clause the targets belong to starts in the request, when the scope knows it. */
    clauseStart?: number;
    /** Every id the batch's calls of this action assert for this argument. */
    compiledArgumentIds: readonly string[];
    /** Every id the compiled list's own selectors excluded or protected. */
    compilerExcludedIds: ReadonlySet<string>;
    context: ProjectContext;
    /** Objects this batch creates; a compiled selector resolved only objects that already exist. */
    createdIds: ReadonlySet<string>;
    dependencyId?: string;
    /** Ids the batch's calls of this action bind to their other target arguments. */
    otherArgumentIds: readonly string[];
    /** The whole original request, where protections and exclusions are read. */
    prompt: string;
    /**
     * Set when each target already resolved against the request the way a direct call does; that
     * resolution is the naming evidence, so only the request's protections remain to apply.
     */
    referenceResolved: boolean;
    /** The selector the call's targets came from, absent when the compiler named every one literally. */
    selectorTerms?: CompiledSelectorTerms;
    /** Buses a send parameter of the call names and its asserted track already sends to. */
    sendBusIds: readonly string[];
    /** The original text of the clause the targets belong to. */
    targetPrompt: string;
    targetIds: readonly string[];
    /** The text values the batch's calls of this action write ("Bass Drum" for a rename). */
    valueTexts: readonly string[];
};

export type CompiledTargetAuthority =
    { status: 'admitted' } | { status: 'refused'; reason: 'unauthorized' | 'reference-mismatch' };

/** Owned capabilities whose candidates a track dependency narrows to that track's objects. */
const TRACK_DEPENDENT_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
    'device',
    'sidechain-capable-device',
]);

const ADMITTED: CompiledTargetAuthority = { status: 'admitted' };
const UNAUTHORIZED: CompiledTargetAuthority = { status: 'refused', reason: 'unauthorized' };

function readReferences(
    text: string,
    capability: Capability,
    context: ProjectContext,
    dependencyId?: string,
    excludedIds: readonly string[] = []
) {
    return resolveAgentReference({
        prompt: text,
        assertedId: undefined,
        capability,
        context,
        dependencyId,
        excludedIds,
    }).candidates;
}

/** Objects of the capability the text names by literal id, whole name or selection. */
function getTieredReferenceIds(
    text: string,
    capability: Capability,
    context: ProjectContext,
    dependencyId?: string,
    excludedIds: readonly string[] = []
): string[] {
    return readReferences(text, capability, context, dependencyId, excludedIds)
        .filter((candidate) => candidate.evidence.some((evidence) => evidence !== 'fuzzy-name'))
        .map((candidate) => candidate.id);
}

/**
 * The objects the text names, reading an owned object against every track the text names as well,
 * so "the EQ on Vocals and the EQ on Keys" names both EQs although no single owner holds them.
 */
function getNamedObjectIds(text: string, capability: Capability, context: ProjectContext, dependencyId?: string) {
    const named = getTieredReferenceIds(text, capability, context, dependencyId);
    if (dependencyId !== undefined || !TRACK_DEPENDENT_CAPABILITIES.has(capability)) {
        return named;
    }
    const ownedByNamedTracks = getTieredReferenceIds(text, 'track', context).flatMap((trackId) =>
        getTieredReferenceIds(text, capability, context, trackId)
    );
    return [...new Set([...named, ...ownedByNamedTracks])];
}

function getTrackOwnedObjectIds(trackId: string, context: ProjectContext): string[] {
    const laneIds = (context.automationLanes ?? []).filter((lane) => lane.trackId === trackId).map((lane) => lane.id);
    const track = context.tracks.find((candidate) => candidate.id === trackId);
    if (track === undefined) {
        return laneIds;
    }
    return [...track.devices.map((device) => device.id), ...track.clips.map((clip) => clip.id), ...laneIds];
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
function getRestrictionRanges(request: MaskedRequest, catalog: GroundingCatalog): { start: number; end: number }[] {
    return findTrackControlRestrictionStarts(request.maskedPrompt).map((start) => ({
        start,
        end: getInstructionEnd(request, start, catalog),
    }));
}

function blankRange(text: string, start: number, end: number): string {
    return `${text.slice(0, start)}${' '.repeat(end - start)}${text.slice(end)}`;
}

/** The text with every whole, case-insensitive occurrence of the names blanked to equal-length spaces. */
function maskWholeNames(text: string, names: readonly string[]): string {
    return names
        .filter((name) => name.trim().length > 0)
        .reduce(
            (masked, name) => masked.replaceAll(wholeWordsPattern(name, 'giu'), (match) => ' '.repeat(match.length)),
            text
        );
}

function wholeWordsPattern(phrase: string, flags: string): RegExp {
    return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(phrase)}(?![\\p{L}\\p{N}])`, flags);
}

/**
 * The clause with the last whole occurrence of each written value blanked out: the value ("rename
 * Kick to Bass Drum") follows the target it is written to, and "rename Kick to Kick In" keeps the
 * earlier mention of the target.
 */
function maskWrittenValues(text: string, values: readonly string[]): string {
    return values
        .filter((value) => value.trim().length > 0)
        .reduce((masked, value) => {
            const last = [...masked.matchAll(wholeWordsPattern(value, 'giu'))].at(-1);
            return last === undefined ? masked : blankRange(masked, last.index, last.index + last[0].length);
        }, text);
}

/** Everything the request protects or excludes, with every object on a protected track. */
function getProtectedIds(
    input: CompiledTargetAuthorityInput,
    request: MaskedRequest,
    restrictionRanges: readonly { start: number; end: number }[]
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
        for (const id of getNamedObjectIds(restriction, input.capability, input.context, input.dependencyId)) {
            protectedIds.add(id);
        }
        // "leave Bass Verse unchanged" protects the clip, not every object on a track named Bass.
        const namedObjectNames = readReferences(restriction, input.capability, input.context, input.dependencyId)
            .filter((candidate) => candidate.evidence.some((evidence) => evidence !== 'fuzzy-name'))
            .map((candidate) => candidate.name);
        const trackRestriction = maskWholeNames(restriction, namedObjectNames);
        for (const trackId of getTieredReferenceIds(trackRestriction, 'track', input.context)) {
            protectedIds.add(trackId);
            for (const ownedId of getTrackOwnedObjectIds(trackId, input.context)) {
                protectedIds.add(ownedId);
            }
        }
    }
    return protectedIds;
}

/**
 * The clause text the targets are read from: the instruction from its start, with the request's
 * restrictions and the values the batch writes blanked, so a name stated only to protect an object
 * or as a new name is never read as picking a target.
 */
function getEvidenceText(
    input: CompiledTargetAuthorityInput,
    request: MaskedRequest,
    restrictionRanges: readonly { start: number; end: number }[]
): string {
    if (input.clauseStart === undefined) {
        return maskWrittenValues(input.targetPrompt, input.valueTexts);
    }
    const end = getInstructionEnd(request, input.clauseStart, input.catalog);
    const unrestricted = restrictionRanges.reduce(
        (text, range) => blankRange(text, range.start, range.end),
        request.prompt
    );
    return maskWrittenValues(unrestricted.slice(input.clauseStart, end), input.valueTexts);
}

/** The names, name fragments and ids a call's targets for one argument are picked by. */
type NamePredicates = { names: string[]; ids: string[] };

function getNamePredicates(input: CompiledTargetAuthorityInput): NamePredicates {
    const terms = input.selectorTerms;
    if (terms === undefined || terms.targetArgument !== input.argument) {
        return { names: [], ids: [...input.targetIds] };
    }
    const names: string[] = [];
    const ids: string[] = [];
    if (terms.where?.name !== undefined) {
        names.push(terms.where.name);
    }
    if (terms.where?.trackId !== undefined) {
        ids.push(terms.where.trackId);
    }
    const predicates = [terms.match?.all, terms.match?.any].flatMap((list) => list ?? []);
    for (const predicate of predicates) {
        if ('nameIncludes' in predicate) {
            names.push(predicate.nameIncludes);
        }
    }
    return { names, ids };
}

/** The names an object is stated by: its own name, and a device's catalogue type name. */
function getObjectNames(objectId: string, context: ProjectContext): string[] {
    for (const track of context.tracks) {
        if (track.id === objectId) {
            return [track.name];
        }
        const clip = track.clips.find((candidate) => candidate.id === objectId);
        if (clip !== undefined) {
            return [clip.name];
        }
        const device = track.devices.find((candidate) => candidate.id === objectId);
        if (device !== undefined) {
            const typeName = (context.availableDeviceTypes ?? []).find((type) => type.id === device.type)?.name;
            return [device.name, typeName].filter((name): name is string => name !== undefined);
        }
    }
    const lane = (context.automationLanes ?? []).find((candidate) => candidate.id === objectId);
    return lane === undefined ? [] : [lane.name];
}

/** Whether the clause states the id literally, states the object's name, or selects it. */
function statesObject(text: string, objectId: string, input: CompiledTargetAuthorityInput): boolean {
    if (
        [objectId, ...getObjectNames(objectId, input.context)].some((name) => wholeWordsPattern(name, 'iu').test(text))
    ) {
        return true;
    }
    const capability: Capability = input.context.tracks.some((track) => track.id === objectId)
        ? 'track'
        : input.capability;
    const result = resolveAgentReference({ prompt: text, assertedId: objectId, capability, context: input.context });
    return result.status === 'resolved' && result.evidence === 'selection';
}

/**
 * How the direct route reads a single target in the clause: as the one exact reference it names
 * beside the batch's other targets for the argument, as a clause that names another object instead,
 * as one that names another object as well, or with no exact reference at all. Every set-aside
 * object stays out of the reading; the batch's other targets stay in it, so a longer name one of
 * them carries still overlaps a shorter one ("Bass, DI" beside a track named Bass).
 */
function resolveLikeDirectCall(
    input: CompiledTargetAuthorityInput,
    text: string,
    setAside: readonly string[]
): 'target' | 'other' | 'ambiguous' | 'none' {
    const [targetId] = input.targetIds;
    if (input.targetIds.length !== 1 || targetId === undefined) {
        return 'none';
    }
    const siblingIds = new Set(input.compiledArgumentIds.filter((id) => id !== targetId));
    const named = getTieredReferenceIds(
        text,
        input.capability,
        input.context,
        input.dependencyId,
        setAside.filter((id) => id !== targetId)
    );
    const others = named.filter((id) => id !== targetId && !siblingIds.has(id));
    if (named.includes(targetId)) {
        return others.length === 0 ? 'target' : 'ambiguous';
    }
    return others.length === 0 ? 'none' : 'other';
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
    const predicates = getNamePredicates(input);
    if (predicates.names.length === 0 && predicates.ids.length === 0) {
        return ADMITTED;
    }
    const text = getEvidenceText(input, request, restrictionRanges);
    const statesEveryPredicate =
        predicates.names.every((name) => wholeWordsPattern(name, 'iu').test(text)) &&
        predicates.ids.every((id) => statesObject(text, id, input));
    if (!statesEveryPredicate) {
        return UNAUTHORIZED;
    }
    const setAside = [
        ...new Set([...input.createdIds, ...protectedIds, ...input.sendBusIds, ...input.otherArgumentIds]),
    ];
    const direct = resolveLikeDirectCall(input, text, setAside);
    if (direct === 'other') {
        return { status: 'refused', reason: 'reference-mismatch' };
    }
    return direct === 'ambiguous' ? UNAUTHORIZED : ADMITTED;
}
