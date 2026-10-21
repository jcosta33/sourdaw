import { type getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { PRESET_ACTIONS } from '../../models/PresetActions/Registry';
import { type ProjectContext } from '../../models/ProjectContext';
import {
    type SemanticCommandListMatch,
    type SemanticCommandListPredicate,
    type SemanticCommandListSelector,
} from '../../models/SemanticCommandList';
import {
    collectSemanticCommandListCandidates,
    type SemanticCommandListCandidate,
} from '../../services/semanticCommandListCandidates';
import { scanPromptQuotedText } from '../../transformers/promptParser/promptQuotedText';
import { CANONICAL_ROLE_TO_RECIPE_ROLE } from '../canonicalRoleFamilies';

import { getAgentReferenceCapabilityKind } from './agentReferenceCapabilityKinds';
import { getApplicationProtectedObjects } from './getApplicationProtectedObjects';
import { escapeRegExp } from './groundingStrategies/escapeRegExp';
import { findTrackControlRestrictionStarts } from './groundingStrategies/findTrackControlRestrictionStarts';
import { getPromptClauses } from './groundingStrategies/getPromptClauses';
import { maskProjectReferences } from './groundingStrategies/maskProjectReferences';
import { maskQuotedLabels } from './groundingStrategies/maskQuotedLabels';
import { normalizePromptText } from './groundingStrategies/normalizePromptText';
import { resolveClauseActionIntent } from './groundingStrategies/resolveClauseActionIntent';
import { resolveAgentReference, type ResolveAgentReferenceInput } from './resolveAgentReference';

type GroundingCatalog = ReturnType<typeof getExecutableAppActionGroundingCatalog>;
type Capability = ResolveAgentReferenceInput['capability'];

/** The fields of the selector a compiled target came from, read from the compiler's evidence. */
export type CompiledSelectorTerms = {
    where?: SemanticCommandListSelector['where'];
    match?: SemanticCommandListMatch;
    condition?: SemanticCommandListSelector['condition'];
};

export type CompiledTargetAuthorityInput = {
    capability: Capability;
    catalog: GroundingCatalog;
    /** Where the clause the targets belong to starts in the request, when the scope knows it. */
    clauseStart?: number;
    /** Every id the batch's calls of this action assert for this argument. */
    compiledArgumentIds: readonly string[];
    /** Every id the compiled list's own selectors excluded or protected. */
    compilerExcludedIds: ReadonlySet<string>;
    context: ProjectContext;
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
    /** The selector the targets came from, absent when the compiler named them literally. */
    selectorTerms?: CompiledSelectorTerms;
    /** Buses a send parameter of the call names and its asserted track already sends to. */
    sendBusIds: readonly string[];
    /** The original text of the clause the targets belong to. */
    targetPrompt: string;
    targetIds: readonly string[];
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
function getNamedObjectIds(
    text: string,
    capability: Capability,
    context: ProjectContext,
    dependencyId?: string,
    excludedIds: readonly string[] = []
) {
    const named = getTieredReferenceIds(text, capability, context, dependencyId, excludedIds);
    if (dependencyId !== undefined || !TRACK_DEPENDENT_CAPABILITIES.has(capability)) {
        return named;
    }
    const ownedByNamedTracks = getTieredReferenceIds(text, 'track', context).flatMap((trackId) =>
        getTieredReferenceIds(text, capability, context, trackId, excludedIds)
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
 * The request text from `start` through every following clause that continues it rather than
 * giving another instruction, up to the end of its sentence: "add a compressor to Vocals and Bass"
 * whole, "set Vocals to 75% but leave Keys alone" whole, and "leave Keys alone and set Drums to
 * 50%" only up to the second instruction.
 */
function getInstructionText(request: MaskedRequest, start: number, catalog: GroundingCatalog): string {
    const sentenceEnd = /[;!?\n]|\.(?!\d)/u.exec(request.maskedPrompt.slice(start));
    const limit = sentenceEnd === null ? request.prompt.length : start + sentenceEnd.index;
    const nextInstruction = request.clauses.find(
        (clause) =>
            clause.start > start && clause.start < limit && resolveClauseActionIntent(clause.masked, catalog) !== null
    );
    return request.prompt.slice(start, nextInstruction?.start ?? limit);
}

/** The text with every whole, case-insensitive occurrence of the names blanked to equal-length spaces. */
function maskWholeNames(text: string, names: readonly string[]): string {
    return names
        .filter((name) => name.trim().length > 0)
        .reduce(
            (masked, name) =>
                masked.replaceAll(
                    new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, 'giu'),
                    (match) => ' '.repeat(match.length)
                ),
            text
        );
}

/** Everything the request protects or excludes, with every object on a protected track. */
function getProtectedIds(input: CompiledTargetAuthorityInput, request: MaskedRequest): Set<string> {
    const protectedIds = new Set(input.compilerExcludedIds);
    for (const object of getApplicationProtectedObjects({
        actions: [],
        context: input.context,
        prompt: input.prompt,
    })) {
        protectedIds.add(object.id);
    }
    const restrictions = findTrackControlRestrictionStarts(request.maskedPrompt).map((start) =>
        getInstructionText(request, start, input.catalog)
    );
    for (const restriction of restrictions) {
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

/** Whether the text states the phrase as whole words, its last word in the singular or the plural. */
function statesPhrase(normalizedText: string, phrase: string): boolean {
    const normalizedPhrase = normalizePromptText(phrase);
    return (
        normalizedPhrase.length > 0 &&
        new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(normalizedPhrase)}(?:e?s)?(?![\\p{L}\\p{N}])`, 'u').test(
            normalizedText
        )
    );
}

/** The word for a track kind and every one-word keyword of the preset that creates that kind. */
function getTrackKindWords(kind: string): string[] {
    const preset = PRESET_ACTIONS.find((candidate) => candidate.id === `add-${kind}-track`);
    const keywords: readonly string[] = preset?.keywords ?? [];
    return [kind, ...keywords.filter((keyword) => !keyword.includes(' '))];
}

/** The device type's catalogue name and its id's own words. */
function getDeviceTypeWords(type: string, context: ProjectContext): string[] {
    const name = (context.availableDeviceTypes ?? []).find((deviceType) => deviceType.id === type)?.name;
    const idWords = type.replace(/^builtin-/u, '').replaceAll('-', ' ');
    return name === undefined ? [idWords] : [name, idWords];
}

function getTrackNameWords(trackId: string, context: ProjectContext): string[] {
    const track = context.tracks.find((candidate) => candidate.id === trackId);
    return track === undefined ? [] : [track.name];
}

function getSectionWords(sectionId: string, context: ProjectContext): string[] {
    const section = (context.sections ?? []).find((candidate) => candidate.id === sectionId);
    return section === undefined ? [sectionId] : [section.name];
}

/** The phrases any one of which states one selector predicate. */
function getPredicatePhrases(predicate: SemanticCommandListPredicate, context: ProjectContext): string[] {
    if ('role' in predicate) {
        return [predicate.role];
    }
    if ('roleFamily' in predicate) {
        return [predicate.roleFamily];
    }
    if ('nameIncludes' in predicate) {
        return [predicate.nameIncludes];
    }
    if ('tag' in predicate) {
        return [predicate.tag];
    }
    if ('kind' in predicate) {
        return getTrackKindWords(predicate.kind);
    }
    if ('hasDeviceType' in predicate) {
        return getDeviceTypeWords(predicate.hasDeviceType, context);
    }
    if ('isMuted' in predicate) {
        return [predicate.isMuted ? 'muted' : 'unmuted'];
    }
    if ('isFrozen' in predicate) {
        return [predicate.isFrozen ? 'frozen' : 'unfrozen'];
    }
    return getSectionWords(predicate.inSection, context);
}

/** One list of alternative phrases per term the selector rests on. */
function getSelectorTermPhrases(terms: CompiledSelectorTerms, context: ProjectContext): string[][] {
    const where = terms.where ?? {};
    const phrases: string[][] = [];
    if (where.name !== undefined) {
        phrases.push([where.name]);
    }
    if (where.kind !== undefined) {
        phrases.push(getTrackKindWords(where.kind));
    }
    if (where.type !== undefined) {
        phrases.push(getDeviceTypeWords(where.type, context));
    }
    if (where.trackId !== undefined) {
        phrases.push(getTrackNameWords(where.trackId, context));
    }
    if (terms.condition !== undefined) {
        phrases.push([terms.condition.equals ? terms.condition.field : `un${terms.condition.field}`]);
    }
    const match: SemanticCommandListMatch = terms.match ?? {};
    const predicates: SemanticCommandListPredicate[] = [];
    if (match.all !== undefined) {
        predicates.push(...match.all);
    }
    if (match.any !== undefined) {
        predicates.push(...match.any);
    }
    phrases.push(...predicates.map((predicate) => getPredicatePhrases(predicate, context)));
    return phrases;
}

function matchesWhere(candidate: SemanticCommandListCandidate | undefined, terms: CompiledSelectorTerms): boolean {
    return (
        candidate !== undefined &&
        Object.entries(terms.where ?? {}).every(
            ([field, value]) => candidate[field as keyof SemanticCommandListCandidate] === value
        )
    );
}

/**
 * Whether the clause states every term of the selector the targets came from, and the targets are
 * what those terms select: "turn down the lead vocal" states a `lead vocal` role, "set volume to 75%"
 * states no `Keys` name.
 */
function statesSelectorTerms(input: CompiledTargetAuthorityInput, text: string): boolean {
    const terms = input.selectorTerms;
    if (terms === undefined) {
        return false;
    }
    const phrases = getSelectorTermPhrases(terms, input.context);
    if (phrases.length === 0) {
        return false;
    }
    const normalizedText = normalizePromptText(scanPromptQuotedText(text).maskedText);
    if (!phrases.every((alternatives) => alternatives.some((phrase) => statesPhrase(normalizedText, phrase)))) {
        return false;
    }
    const candidates = collectSemanticCommandListCandidates({
        context: input.context,
        roleFamilyByCanonicalRole: CANONICAL_ROLE_TO_RECIPE_ROLE,
    });
    return input.targetIds.every((targetId) =>
        matchesWhere(
            candidates.find((candidate) => candidate.id === targetId),
            terms
        )
    );
}

function getOwningTrackId(objectId: string, context: ProjectContext): string | undefined {
    const owner = context.tracks.find(
        (track) =>
            track.devices.some((device) => device.id === objectId) || track.clips.some((clip) => clip.id === objectId)
    );
    return owner?.id ?? context.automationLanes?.find((lane) => lane.id === objectId)?.trackId;
}

/**
 * Whether a single target resolves against the clause the way a direct call does: the unique
 * reference the clause grounds, a different unique reference, or no unique reference at all.
 */
function resolveLikeDirectCall(
    input: CompiledTargetAuthorityInput,
    text: string,
    excludedIds: readonly string[]
): 'target' | 'other' | 'none' {
    const [targetId] = input.targetIds;
    if (input.targetIds.length !== 1 || targetId === undefined) {
        return 'none';
    }
    const result = resolveAgentReference({
        prompt: text,
        assertedId: targetId,
        capability: input.capability,
        context: input.context,
        dependencyId: input.dependencyId,
        excludedIds: excludedIds.filter((id) => id !== targetId),
    });
    if (result.status === 'resolved') {
        return 'target';
    }
    return result.reason === 'asserted-target-mismatch' ? 'other' : 'none';
}

/**
 * Whether the request authorizes every target a compiled selector resolved for one argument.
 *
 * Compiler evidence proves which objects a selector resolves to, never that the request asked for
 * them. A target the request protects or excludes is refused. A single target the clause grounds
 * the way a direct call would is admitted, and one the clause grounds differently is refused. Past
 * that, a clause that names objects of the target's capability admits exactly that set; a clause
 * that names none admits only targets whose every selector term it states, and an owned object only
 * on a track the clause names when it names any.
 */
export function admitsCompiledTargets(input: CompiledTargetAuthorityInput): CompiledTargetAuthority {
    const { capability, context, dependencyId, targetIds } = input;
    const request = maskRequest(input.prompt, context);
    const protectedIds = getProtectedIds(input, request);
    if (targetIds.some((targetId) => protectedIds.has(targetId))) {
        return UNAUTHORIZED;
    }
    if (input.referenceResolved) {
        return ADMITTED;
    }
    let text = input.targetPrompt;
    if (input.clauseStart !== undefined) {
        text = getInstructionText(request, input.clauseStart, input.catalog);
    }
    const setAside = [...new Set([...protectedIds, ...input.sendBusIds, ...input.otherArgumentIds])];
    const direct = resolveLikeDirectCall(input, text, setAside);
    if (direct === 'target') {
        return ADMITTED;
    }
    if (direct === 'other') {
        return { status: 'refused', reason: 'reference-mismatch' };
    }
    const named = getNamedObjectIds(text, capability, context, dependencyId, setAside);
    if (named.length > 0) {
        const compiledIds = new Set(input.compiledArgumentIds);
        const admitsNamedSet =
            targetIds.every((targetId) => named.includes(targetId)) && named.every((id) => compiledIds.has(id));
        return admitsNamedSet ? ADMITTED : UNAUTHORIZED;
    }
    if (!statesSelectorTerms(input, text)) {
        return UNAUTHORIZED;
    }
    if (getAgentReferenceCapabilityKind(capability) === 'track') {
        return ADMITTED;
    }
    const namedTrackIds = getTieredReferenceIds(text, 'track', context, undefined, setAside);
    const ownedOnNamedTracks =
        namedTrackIds.length === 0 ||
        targetIds.every((targetId) => namedTrackIds.includes(getOwningTrackId(targetId, context) ?? ''));
    return ownedOnNamedTracks ? ADMITTED : UNAUTHORIZED;
}
