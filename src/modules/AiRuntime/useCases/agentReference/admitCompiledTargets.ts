import { type getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../models/ProjectContext';
import { type SemanticCommandListMatch, type SemanticCommandListSelector } from '../../models/SemanticCommandList';

import { getAgentReferenceCapabilityKind } from './agentReferenceCapabilityKinds';
import { getApplicationProtectedObjects } from './getApplicationProtectedObjects';
import { escapeRegExp } from './groundingStrategies/escapeRegExp';
import { findTrackControlRestrictionStarts } from './groundingStrategies/findTrackControlRestrictionStarts';
import { getPromptClauses } from './groundingStrategies/getPromptClauses';
import { maskProjectReferences } from './groundingStrategies/maskProjectReferences';
import { maskQuotedLabels } from './groundingStrategies/maskQuotedLabels';
import { resolveClauseActionIntent } from './groundingStrategies/resolveClauseActionIntent';
import { isAgentReferenceCapabilityCandidate } from './isAgentReferenceCapabilityCandidate';
import { resolveAgentReference, type ResolveAgentReferenceInput } from './resolveAgentReference';

/*
 * Compiled target authority (#5295).
 *
 * A compiled command list proves which objects its selectors resolve to, never that the user asked
 * for them. This check closes one hole: a selector that picks an object by a name or id the request
 * never states. Every target the request protects or excludes is refused. A selector's whole-name
 * pick must appear whole in the request's original text, a name fragment as the start of a word
 * there (optionally pluralized with "s" or "es"), and an owner-track pick as that track's whole name
 * or id; the text read is the whole request less its restrictions and the values the batch writes,
 * so an instruction may pick by a name an earlier one states ("turn Vocals down and pan it left").
 * A selection reference ("this track", "the selected track", "it" for the selected track) that
 * resolves to the picked objects states those picks only when the request names no object of that
 * kind by name, so "set Vocals volume so it sits better" never stands for the selected Keys.
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
    /** The text values the batch's calls of this action write ("Bass Drum" for a rename). */
    valueTexts: readonly string[];
};

export type CompiledTargetAuthority = { status: 'admitted' } | { status: 'refused' };

/** Owned capabilities whose candidates a track dependency narrows to that track's objects. */
const TRACK_DEPENDENT_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
    'device',
    'sidechain-capable-device',
]);

const ADMITTED: CompiledTargetAuthority = { status: 'admitted' };
const UNAUTHORIZED: CompiledTargetAuthority = { status: 'refused' };

function readReferences(text: string, capability: Capability, context: ProjectContext, dependencyId?: string) {
    return resolveAgentReference({ prompt: text, assertedId: undefined, capability, context, dependencyId }).candidates;
}

/** Objects of the capability the text names by literal id, whole name or selection. */
function getTieredReferenceIds(
    text: string,
    capability: Capability,
    context: ProjectContext,
    dependencyId?: string
): string[] {
    return readReferences(text, capability, context, dependencyId)
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
 * The text the targets are read from: the whole request, so a later instruction may pick by a name
 * an earlier one states ("mute Vocals and bypass the EQ on it"), with its restrictions and the values
 * the batch writes blanked, so a name stated only to protect an object or as a new name is never
 * read as picking a target.
 */
function getEvidenceText(
    input: CompiledTargetAuthorityInput,
    request: MaskedRequest,
    restrictionRanges: readonly { start: number; end: number }[]
): string {
    const unrestricted = restrictionRanges.reduce(
        (text, range) => blankRange(text, range.start, range.end),
        request.prompt
    );
    return maskWrittenValues(unrestricted, input.valueTexts);
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

/**
 * Whether the request's selection reference is the object: "this track" or "the selected track"
 * through the direct route's selection reading, or "it" for the selected track.
 */
function selectsObject(text: string, objectId: string, capability: Capability, context: ProjectContext): boolean {
    if (objectId === context.selectedTrackId && /\bit\b/iu.test(text)) {
        return true;
    }
    const result = resolveAgentReference({ prompt: text, assertedId: objectId, capability, context });
    return result.status === 'resolved' && result.evidence === 'selection';
}

function statesWholeReference(text: string, references: readonly string[]): boolean {
    return references.some((reference) => wholeWordsPattern(reference, 'iu').test(text));
}

/**
 * Whether the text names an object of the capability by its whole name or id rather than through a
 * selection. Tracks are read against every candidate track, because the selection reading narrows
 * its candidates to the selected track once the text says "this track".
 */
function namesObjectByName(text: string, capability: Capability, context: ProjectContext): boolean {
    if (getAgentReferenceCapabilityKind(capability) === 'track') {
        return context.tracks.some(
            (track) =>
                isAgentReferenceCapabilityCandidate({ capability, context, id: track.id }) &&
                statesWholeReference(text, [track.id, track.name])
        );
    }
    return readReferences(text, capability, context).some((candidate) =>
        candidate.evidence.some((evidence) => evidence !== 'selection' && evidence !== 'fuzzy-name')
    );
}

/**
 * Whether the request's selection reference stands for every target, which states any name the
 * selector picks them by; it stands for nothing once the request names an object of that kind.
 */
function selectsEveryTarget(text: string, input: CompiledTargetAuthorityInput): boolean {
    return (
        !namesObjectByName(text, input.capability, input.context) &&
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

/** Whether the request states the owner track by its whole name or id, or selects it without naming a track. */
function statesTrack(text: string, trackId: string, context: ProjectContext): boolean {
    const name = context.tracks.find((track) => track.id === trackId)?.name;
    if (statesWholeReference(text, name === undefined ? [trackId] : [trackId, name])) {
        return true;
    }
    return !namesObjectByName(text, 'track', context) && selectsObject(text, trackId, 'track', context);
}

/** Whether a word of the text starts with the fragment and goes on with at most a plural "s" or "es". */
function statesFragment(text: string, fragment: string): boolean {
    return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(fragment)}(?:e?s)?(?![\\p{L}\\p{N}])`, 'iu').test(text);
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
    const statesNamePicks =
        (picks.names.every((name) => wholeWordsPattern(name, 'iu').test(text)) &&
            picks.fragments.every((fragment) => statesFragment(text, fragment))) ||
        selectsEveryTarget(text, input);
    const statesTrackPicks =
        picks.trackIds.every((trackId) => statesTrack(text, trackId, input.context)) ||
        !refersToAnyTrack(text, input.context);
    return statesNamePicks && statesTrackPicks ? ADMITTED : UNAUTHORIZED;
}
