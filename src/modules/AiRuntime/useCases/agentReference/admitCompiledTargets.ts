import { type getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../models/ProjectContext';
import {
    collectSemanticCommandListCandidates,
    type SemanticCommandListCandidate,
} from '../../services/semanticCommandListCandidates';
import { scanPromptQuotedText } from '../../transformers/promptParser/promptQuotedText';
import { CANONICAL_ROLE_TO_RECIPE_ROLE } from '../canonicalRoleFamilies';

import { getAgentReferenceCapabilityKind } from './agentReferenceCapabilityKinds';
import { getApplicationProtectedObjects } from './getApplicationProtectedObjects';
import { findTrackControlRestrictionStarts } from './groundingStrategies/findTrackControlRestrictionStarts';
import { getPromptClauses } from './groundingStrategies/getPromptClauses';
import { maskProjectReferences } from './groundingStrategies/maskProjectReferences';
import { maskQuotedLabels } from './groundingStrategies/maskQuotedLabels';
import { normalizePromptText } from './groundingStrategies/normalizePromptText';
import { resolveClauseActionIntent } from './groundingStrategies/resolveClauseActionIntent';
import { resolveAgentReference, type ResolveAgentReferenceInput } from './resolveAgentReference';

type GroundingCatalog = ReturnType<typeof getExecutableAppActionGroundingCatalog>;
type Capability = ResolveAgentReferenceInput['capability'];

export type CompiledTargetAuthorityInput = {
    capability: Capability;
    catalog: GroundingCatalog;
    /** Where the clause the targets belong to starts in the request, when the scope knows it. */
    clauseStart?: number;
    /** Every id the compiled list's own selectors excluded or protected. */
    compilerExcludedIds: ReadonlySet<string>;
    context: ProjectContext;
    /** Objects this batch creates; a compiled selector resolved only objects that already exist. */
    createdIds: ReadonlySet<string>;
    dependencyId?: string;
    /** The whole original request, where protections and exclusions are read. */
    prompt: string;
    /** Buses a send parameter of the call names and its asserted track already sends to. */
    sendBusIds: readonly string[];
    /** The original text of the clause the targets belong to. */
    targetPrompt: string;
    targetIds: readonly string[];
};

/** Owned capabilities whose candidates a track dependency narrows to that track's objects. */
const TRACK_DEPENDENT_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
    'device',
    'sidechain-capable-device',
]);

const SELECTION_QUANTIFIERS: ReadonlySet<string> = new Set(['all', 'every', 'each', 'the']);
const SELECTION_QUANTIFIER_FILLERS: ReadonlySet<string> = new Set(['of', 'the']);
const SELECTION_QUALIFIER_BREAKS: ReadonlySet<string> = new Set([
    'a',
    'all',
    'an',
    'and',
    'at',
    'by',
    'each',
    'every',
    'for',
    'from',
    'in',
    'of',
    'on',
    'the',
    'to',
    'with',
]);
const MAX_SELECTION_QUALIFIERS = 2;

const TRACK_SELECTION_NOUNS = {
    singular: ['track', 'channel', 'bus'],
    plural: ['tracks', 'channels', 'buses', 'busses'],
};
const DEVICE_SELECTION_NOUNS = { singular: ['device', 'plugin', 'effect', 'insert'], plural: [] as string[] };
const CLIP_SELECTION_NOUNS = { singular: ['clip', 'region'], plural: [] as string[] };
const LANE_SELECTION_NOUNS = { singular: ['lane'], plural: [] as string[] };

type SelectionNoun = { word: string; singular: string; plural: boolean; deviceTypeName?: string };
type BoundedSelection = { noun: SelectionNoun; qualifiers: string[] };

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

function hasFuzzyOnlyMention(text: string, capability: Capability, context: ProjectContext, dependencyId?: string) {
    return readReferences(text, capability, context, dependencyId).some((candidate) =>
        candidate.evidence.every((evidence) => evidence === 'fuzzy-name')
    );
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
        for (const trackId of getTieredReferenceIds(restriction, 'track', input.context)) {
            protectedIds.add(trackId);
            for (const ownedId of getTrackOwnedObjectIds(trackId, input.context)) {
                protectedIds.add(ownedId);
            }
        }
    }
    return protectedIds;
}

function getDeviceTypeName(type: string | undefined, context: ProjectContext): string {
    const name = (context.availableDeviceTypes ?? []).find((deviceType) => deviceType.id === type)?.name;
    return normalizePromptText(name ?? (type ?? '').replace(/^builtin-/u, ''));
}

function getSelectionNouns(capability: Capability, context: ProjectContext): SelectionNoun[] {
    const fromWords = (words: { singular: string[]; plural: string[] }): SelectionNoun[] => [
        ...words.singular.flatMap((singular) => [
            { word: singular, singular, plural: false },
            { word: `${singular}s`, singular, plural: true },
        ]),
        ...words.plural.map((word) => ({
            word,
            singular: words.singular.find((singular) => word.startsWith(singular)) ?? word,
            plural: true,
        })),
    ];
    const kind = getAgentReferenceCapabilityKind(capability);
    if (kind === 'track') {
        return fromWords(TRACK_SELECTION_NOUNS);
    }
    if (kind === 'clip') {
        return fromWords(CLIP_SELECTION_NOUNS);
    }
    if (capability === 'automation-lane') {
        return fromWords(LANE_SELECTION_NOUNS);
    }
    if (!TRACK_DEPENDENT_CAPABILITIES.has(capability)) {
        return [];
    }
    const typeNames = [...new Set((context.availableDeviceTypes ?? []).map((type) => normalizePromptText(type.name)))];
    return [
        ...fromWords(DEVICE_SELECTION_NOUNS),
        ...typeNames
            .filter((name) => name.length > 0 && !name.includes(' '))
            .flatMap((name) => [
                { word: `${name}s`, singular: name, plural: true, deviceTypeName: name },
                { word: `${name}es`, singular: name, plural: true, deviceTypeName: name },
            ]),
    ];
}

/**
 * The bounded selections the clause states: a quantifier ("all", "every", "each", or "the" before a
 * plural), at most two qualifying words, and a noun of the target's capability ("all audio tracks",
 * "every device", "the EQs").
 */
function getBoundedSelections(text: string, capability: Capability, context: ProjectContext): BoundedSelection[] {
    const nouns = getSelectionNouns(capability, context);
    const tokens = normalizePromptText(scanPromptQuotedText(text).maskedText).split(' ');
    return tokens.flatMap((token, index) => {
        if (!SELECTION_QUANTIFIERS.has(token)) {
            return [];
        }
        const selection = readSelectionAfterQuantifier(tokens, index, nouns);
        return selection === null ? [] : [selection];
    });
}

function readSelectionAfterQuantifier(
    tokens: readonly string[],
    quantifierIndex: number,
    nouns: readonly SelectionNoun[]
): BoundedSelection | null {
    const quantifier = tokens[quantifierIndex];
    let cursor = quantifierIndex + 1;
    while (quantifier !== 'the' && SELECTION_QUANTIFIER_FILLERS.has(tokens[cursor] ?? '')) {
        cursor += 1;
    }
    const qualifiers: string[] = [];
    for (const word of tokens.slice(cursor)) {
        const noun = nouns.find((candidate) => candidate.word === word && (quantifier !== 'the' || candidate.plural));
        if (noun !== undefined) {
            return { noun, qualifiers };
        }
        if (SELECTION_QUALIFIER_BREAKS.has(word) || qualifiers.length === MAX_SELECTION_QUALIFIERS) {
            return null;
        }
        qualifiers.push(word);
    }
    return null;
}

function stem(word: string): string {
    return word.replace(/s$/u, '');
}

function getCandidateFacts(candidate: SemanticCommandListCandidate, context: ProjectContext): Set<string> {
    const phrases: string[] = [
        candidate.kind,
        candidate.name,
        candidate.ownerKind,
        candidate.ownerCanonicalRole,
        candidate.ownerRoleFamily,
    ].filter((phrase): phrase is string => typeof phrase === 'string');
    if (candidate.ownerTags !== undefined) {
        phrases.push(...candidate.ownerTags);
    }
    if (candidate.entity === 'device') {
        phrases.push(getDeviceTypeName(candidate.type, context));
    }
    const words = phrases.flatMap((phrase) => normalizePromptText(phrase).split(' '));
    return new Set(words.filter((word) => word.length > 0).map(stem));
}

function satisfiesSelection(
    selection: BoundedSelection,
    candidate: SemanticCommandListCandidate | undefined,
    context: ProjectContext
): boolean {
    if (candidate === undefined) {
        return false;
    }
    if (selection.noun.deviceTypeName !== undefined) {
        if (
            candidate.entity !== 'device' ||
            getDeviceTypeName(candidate.type, context) !== selection.noun.deviceTypeName
        ) {
            return false;
        }
    }
    if (selection.noun.singular === 'bus' && candidate.kind !== 'bus') {
        return false;
    }
    const facts = getCandidateFacts(candidate, context);
    return selection.qualifiers.every((qualifier) => facts.has(stem(qualifier)));
}

function getOwningTrackId(objectId: string, context: ProjectContext): string | undefined {
    const owner = context.tracks.find(
        (track) =>
            track.devices.some((device) => device.id === objectId) || track.clips.some((clip) => clip.id === objectId)
    );
    return owner?.id ?? context.automationLanes?.find((lane) => lane.id === objectId)?.trackId;
}

/**
 * Whether the request authorizes every target a compiled selector resolved for one argument.
 *
 * Compiler evidence proves which objects a selector resolves to, never that the request asked for
 * them. A target the request protects or excludes is refused. A clause that names objects of the
 * target's capability authorizes exactly those, so every compiled target must be one of them. A
 * clause whose only mention is an approximate name authorizes nothing. A clause that names nothing
 * authorizes only a bounded selection it states, every compiled target meeting it, and an owned
 * object only on a track the clause names when it names any.
 */
export function admitsCompiledTargets(input: CompiledTargetAuthorityInput): boolean {
    const { capability, context, dependencyId, targetIds } = input;
    const request = maskRequest(input.prompt, context);
    const protectedIds = getProtectedIds(input, request);
    if (targetIds.some((targetId) => protectedIds.has(targetId))) {
        return false;
    }
    let targetPrompt = input.targetPrompt;
    if (input.clauseStart !== undefined) {
        targetPrompt = getInstructionText(request, input.clauseStart, input.catalog);
    }
    const setAside = new Set([...input.createdIds, ...protectedIds, ...input.sendBusIds]);
    const named = getNamedObjectIds(targetPrompt, capability, context, dependencyId).filter((id) => !setAside.has(id));
    if (named.length > 0) {
        return targetIds.every((targetId) => named.includes(targetId));
    }
    if (hasFuzzyOnlyMention(targetPrompt, capability, context, dependencyId)) {
        return false;
    }
    const candidates = collectSemanticCommandListCandidates({
        context,
        roleFamilyByCanonicalRole: CANONICAL_ROLE_TO_RECIPE_ROLE,
    });
    const satisfiesStatedSelection = getBoundedSelections(targetPrompt, capability, context).some((selection) =>
        targetIds.every((targetId) =>
            satisfiesSelection(
                selection,
                candidates.find((candidate) => candidate.id === targetId),
                context
            )
        )
    );
    if (!satisfiesStatedSelection) {
        return false;
    }
    if (getAgentReferenceCapabilityKind(capability) === 'track') {
        return true;
    }
    const namedTrackIds = getTieredReferenceIds(targetPrompt, 'track', context).filter((id) => !setAside.has(id));
    return (
        namedTrackIds.length === 0 ||
        targetIds.every((targetId) => namedTrackIds.includes(getOwningTrackId(targetId, context) ?? ''))
    );
}
