import { getExecutableAppActionGroundingRules } from '#/modules/Command/useCases';
import { getSidechainTargetCapability } from '#/modules/Routing/useCases';

import { type ProjectContext } from '../models/ProjectContext';
import {
    parseSemanticCommandList,
    SEMANTIC_COMMAND_LIST_MAX_COMMANDS,
    SEMANTIC_COMMAND_LIST_MAX_REPEAT,
    type SemanticCommandListEntity,
    type SemanticCommandListItem,
    type SemanticCommandListSelector,
} from '../models/SemanticCommandList';
import { normalizeAgentPlanProposal } from '../transformers/normalizeAgentPlanProposal';
import { type ToolCallResult } from '../transformers/toolCallParser';

import { isAgentReferenceCapabilityCandidate } from './agentReference/isAgentReferenceCapabilityCandidate';

type Candidate = {
    id: string;
    entity: SemanticCommandListEntity;
    name?: string;
    kind?: string;
    type?: string;
    trackId?: string;
    muted?: boolean;
    locked?: boolean;
    bypassed?: boolean;
    enabled?: boolean;
};

export type ArbitraryCommandListSelectorEvidence = {
    itemId: string;
    stableIds: string[];
    excludedIds: string[];
    protectedExclusions: string[];
    preconditions: Array<{ stableId: string; fingerprint: string }>;
};

export type ArbitraryCommandListDirectTargetEvidence = {
    argument: string;
    capability: string;
    cardinality: 'one' | 'many';
    stableIds: string[];
};

type CompiledItemEvidence = {
    canonicalStableIds: string[];
    declaredCommandIdentities: string[];
    itemId: string;
    commandName: string;
    dependsOn: string[];
    declaredCommandCount: number;
    omittedCommandCount: number;
    representativeCommandIndexes: number[];
    stableIds: string[];
    commandStart: number;
    commandCount: number;
    targetArgument?: string;
    targetCapability?: string;
    targetCardinality?: 'many';
    directTargets?: ArbitraryCommandListDirectTargetEvidence[];
};

export type ArbitraryCommandListEvidence = {
    schemaVersion: 1;
    snapshotRevision: string;
    providerKnownTargetIds: string[];
    selectors: ArbitraryCommandListSelectorEvidence[];
    items: CompiledItemEvidence[];
    commands: ToolCallResult[];
};

type AcceptedCompilation = {
    status: 'accepted';
    calls: ToolCallResult[];
    evidence: ArbitraryCommandListSelectorEvidence[];
    compilerEvidence?: ArbitraryCommandListEvidence;
    snapshotRevision: string;
};

type RejectedCompilation = { status: 'rejected'; reason: string };

export type ArbitraryCommandListCompilation = AcceptedCompilation | RejectedCompilation;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return Object.keys(value).every((key) => keys.includes(key));
}

function isSafeId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function collectCandidates(context: ProjectContext): Candidate[] {
    const tracks = context.tracks.map((track) => ({
        id: track.id,
        entity: 'track' as const,
        name: track.name,
        kind: track.kind,
        muted: track.muted,
    }));
    const clips = context.tracks.flatMap((track) =>
        track.clips.map((clip) => ({
            id: clip.id,
            entity: 'clip' as const,
            name: clip.name,
            type: clip.type,
            trackId: track.id,
            muted: clip.muted,
            locked: clip.locked,
        }))
    );
    const devices = context.tracks.flatMap((track) =>
        track.devices.map((device) => ({
            id: device.id,
            entity: 'device' as const,
            name: device.name,
            type: device.type,
            trackId: track.id,
            bypassed: device.bypassed,
        }))
    );
    const lanes = (context.automationLanes ?? []).map((lane) => ({
        id: lane.id,
        entity: 'automation-lane' as const,
        name: lane.name,
        trackId: lane.trackId,
        enabled: lane.enabled,
    }));
    const adjustmentLayers = (context.adjustmentLayers ?? []).map((layer) => ({
        id: layer.id,
        entity: 'adjustment-layer' as const,
        name: layer.name,
        type: layer.effectType,
        enabled: layer.enabled,
    }));
    return [...tracks, ...clips, ...devices, ...lanes, ...adjustmentLayers];
}

function containsForbiddenProviderAuthority(value: unknown): boolean {
    if (!isRecord(value)) {
        return Array.isArray(value) && value.some(containsForbiddenProviderAuthority);
    }
    return Object.entries(value).some(
        ([key, nested]) =>
            /approval|token|expected(?:state)?|revision/iu.test(key) || containsForbiddenProviderAuthority(nested)
    );
}

function parseIdList(value: unknown, label: string): string[] | RejectedCompilation {
    if (!Array.isArray(value) || value.length > SEMANTIC_COMMAND_LIST_MAX_COMMANDS) {
        return { status: 'rejected', reason: `${label} must contain bounded stable IDs.` };
    }
    const ids: string[] = [];
    for (const entry of value) {
        if (!isSafeId(entry)) {
            return { status: 'rejected', reason: `${label} must contain bounded stable IDs.` };
        }
        if (ids.includes(entry)) {
            return { status: 'rejected', reason: `${label} contains duplicate stable IDs.` };
        }
        ids.push(entry);
    }
    return ids;
}

function resolveSelector(input: {
    candidates: readonly Candidate[];
    selector: SemanticCommandListSelector;
    itemId: string;
}): { stableIds: string[]; evidence: ArbitraryCommandListSelectorEvidence } | RejectedCompilation {
    const where = input.selector.where ?? {};
    const candidates = input.candidates.filter((candidate) => {
        if (candidate.entity !== input.selector.entity) {
            return false;
        }
        if (Object.entries(where).some(([key, value]) => candidate[key as keyof Candidate] !== value)) {
            return false;
        }
        return (
            input.selector.condition === undefined ||
            candidate[input.selector.condition.field] === input.selector.condition.equals
        );
    });
    const explicitlyExcludedIds = input.selector.excludeIds ?? [];
    const excludedIds = new Set(explicitlyExcludedIds);
    const stableIds = candidates.filter((candidate) => !excludedIds.has(candidate.id)).map((candidate) => candidate.id);
    if (stableIds.length !== input.selector.quantity.exactly) {
        return {
            status: 'rejected',
            reason: `Bulk selector ${input.itemId} resolved ${String(stableIds.length)} targets, not its exact quantity.`,
        };
    }
    return {
        stableIds,
        evidence: {
            itemId: input.itemId,
            stableIds,
            excludedIds: [...explicitlyExcludedIds],
            protectedExclusions: [],
            preconditions: stableIds.map((stableId) => {
                const candidate = candidates.find((entry) => entry.id === stableId);
                return { stableId, fingerprint: JSON.stringify(candidate) };
            }),
        },
    };
}

function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(',')}]`;
    }
    if (isRecord(value)) {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

function getCanonicalCommandIdentity(command: ToolCallResult): string {
    return canonicalJson(command);
}

type ExecutableAppActionGroundingRules = NonNullable<ReturnType<typeof getExecutableAppActionGroundingRules>>;
type MutationIdentityRule = ExecutableAppActionGroundingRules['mutationIdentityRules'][number];
type MutationIdentityArgument = MutationIdentityRule['arguments'][number];
type AppDerivedMutationIdentityArgument = Extract<MutationIdentityArgument, { source: 'app-derived' }>;
type AppDerivedMutationIdentityArgumentName = AppDerivedMutationIdentityArgument['argument'];
type AppDerivedParentTrackTargetCapability = AppDerivedMutationIdentityArgument['targetCapabilities'][number];
type ExecutableAppActionTargetRule = ExecutableAppActionGroundingRules['targetRules'][number];

function expandMutationIdentityValues(
    argumentRules: MutationIdentityRule['arguments'],
    arguments_: Readonly<Record<string, unknown>>
): unknown[][] | null {
    let expandedIdentityValues: unknown[][] = [[]];
    for (const argumentRule of argumentRules) {
        const value = arguments_[argumentRule.argument];
        if (argumentRule.cardinality === 'many' && (!Array.isArray(value) || value.length === 0)) {
            return null;
        }
        const values = argumentRule.cardinality === 'many' ? (value as unknown[]) : [value];
        expandedIdentityValues = expandedIdentityValues.flatMap((identityValues) =>
            values.map((entry) => [...identityValues, entry])
        );
    }
    return expandedIdentityValues;
}

function getExpandedMutationIdentityValues(
    rule: MutationIdentityRule,
    arguments_: Readonly<Record<string, unknown>>
): unknown[][] | null {
    if (
        rule.fallbackArguments !== undefined &&
        rule.arguments.some((argumentRule) => arguments_[argumentRule.argument] === undefined)
    ) {
        return expandMutationIdentityValues(rule.fallbackArguments, arguments_);
    }
    const primaryValues = expandMutationIdentityValues(rule.arguments, arguments_);
    return primaryValues;
}

function getMutationWriteIdentities(
    name: string,
    mutationIdentityRules: readonly MutationIdentityRule[],
    arguments_: Readonly<Record<string, unknown>>
): string[] | null {
    if (mutationIdentityRules.length === 0) {
        return [];
    }
    const mutationWriteIdentities: string[] = [];
    for (const rule of mutationIdentityRules) {
        if (rule.resourceReferenceOnly === true) {
            continue;
        }
        const expandedIdentityValues = getExpandedMutationIdentityValues(rule, arguments_);
        if (expandedIdentityValues === null) {
            return null;
        }
        mutationWriteIdentities.push(
            ...expandedIdentityValues.map((mutationIdentity) => canonicalJson({ name, mutationIdentity }))
        );
    }
    return mutationWriteIdentities;
}

function getMutationResourceWriteIdentities(
    mutationIdentityRules: readonly MutationIdentityRule[],
    arguments_: Readonly<Record<string, unknown>>
): Array<{ identity: string; destructive?: false }> | null {
    const resourceWriteIdentities: Array<{ identity: string; destructive?: false }> = [];
    for (const rule of mutationIdentityRules) {
        if (rule.resourceFamily === undefined) {
            continue;
        }
        const expandedIdentityValues = getExpandedMutationIdentityValues(rule, arguments_);
        if (expandedIdentityValues === null) {
            return null;
        }
        resourceWriteIdentities.push(
            ...expandedIdentityValues.map((mutationIdentity) => ({
                identity: canonicalJson({ resourceFamily: rule.resourceFamily, mutationIdentity }),
                ...(rule.destructive === false ? { destructive: false as const } : {}),
            }))
        );
    }
    return resourceWriteIdentities;
}

function materializeSidechainRouteIdentityArguments(
    command: ToolCallResult,
    context: ProjectContext
): Record<string, unknown> {
    const materializedArguments: Record<string, unknown> = { ...command.arguments };
    if (command.name === 'addSidechainRoute' || command.name === 'removeSidechainRoute') {
        const sourceTrackId = command.arguments.sourceTrackId;
        const suppliedTargetTrackId = command.arguments.targetTrackId;
        const suppliedTargetDeviceId = command.arguments.targetDeviceId;
        const targetTrackIdFromDevice =
            typeof suppliedTargetDeviceId === 'string'
                ? context.tracks.find((track) => track.devices.some((device) => device.id === suppliedTargetDeviceId))
                      ?.id
                : undefined;
        const targetTrackId = targetTrackIdFromDevice ?? suppliedTargetTrackId;
        if (typeof targetTrackId === 'string') {
            materializedArguments.targetTrackId = targetTrackId;
            const existingRouteDeviceIds =
                typeof sourceTrackId === 'string'
                    ? (context.sidechainRoutes ?? [])
                          .filter(
                              (route) => route.sourceTrackId === sourceTrackId && route.targetTrackId === targetTrackId
                          )
                          .map((route) => route.targetDeviceId)
                    : [];
            const supportedTargetDeviceIds =
                context.tracks
                    .find((track) => track.id === targetTrackId)
                    ?.devices.filter((device) => getSidechainTargetCapability(device.type) !== null)
                    .map((device) => device.id) ?? [];
            let targetDeviceId: string | undefined;
            if (typeof suppliedTargetDeviceId === 'string') {
                targetDeviceId = suppliedTargetDeviceId;
            } else if (existingRouteDeviceIds.length === 1) {
                targetDeviceId = existingRouteDeviceIds[0];
            } else if (supportedTargetDeviceIds.length === 1) {
                targetDeviceId = supportedTargetDeviceIds[0];
            }
            if (targetDeviceId !== undefined) {
                materializedArguments.targetDeviceId = targetDeviceId;
            }
        }
    }
    return materializedArguments;
}

function getTargetRuleValues(
    targetRule: ExecutableAppActionTargetRule,
    arguments_: Readonly<Record<string, unknown>>
): readonly string[] | null {
    const value = arguments_[targetRule.argument];
    if (value === undefined && targetRule.optional === true) {
        return [];
    }
    if (targetRule.cardinality === 'many') {
        return Array.isArray(value) && value.length > 0 && value.every(isSafeId) ? value : null;
    }
    return isSafeId(value) ? [value] : null;
}

function resolveParentTrackId(
    capability: AppDerivedParentTrackTargetCapability,
    targetId: string,
    context: ProjectContext
): string | null {
    switch (capability) {
        case 'track':
        case 'routable-source':
        case 'bus':
            return targetId;
        case 'device':
        case 'sidechain-capable-device':
            return context.tracks.find((track) => track.devices.some((device) => device.id === targetId))?.id ?? null;
        case 'automation-lane':
            return (context.automationLanes ?? []).find((lane) => lane.id === targetId)?.trackId ?? null;
        case 'clip':
        case 'editable-clip':
        case 'editable-audio-clip':
        case 'editable-midi-clip':
        case 'writable-midi-clip':
            return context.tracks.find((track) => track.clips.some((clip) => clip.id === targetId))?.id ?? null;
    }
    const exhaustiveCapability: never = capability;
    return exhaustiveCapability;
}

function isParentTrackTargetCapability(
    capability: ExecutableAppActionTargetRule['capability'],
    allowedCapabilities: readonly AppDerivedParentTrackTargetCapability[]
): capability is AppDerivedParentTrackTargetCapability {
    return allowedCapabilities.some((allowedCapability) => allowedCapability === capability);
}

type AppDerivedMutationIdentityMaterializer = (input: {
    argumentRule: AppDerivedMutationIdentityArgument;
    arguments_: Readonly<Record<string, unknown>>;
    context: ProjectContext;
    targetRules: ExecutableAppActionGroundingRules['targetRules'];
}) => readonly string[] | null;

const materializeParentTrackIds: AppDerivedMutationIdentityMaterializer = ({
    argumentRule,
    arguments_,
    context,
    targetRules,
}) => {
    const parentTrackIds = new Set<string>();
    let matchedTargetRule = false;
    for (const targetRule of targetRules) {
        if (!isParentTrackTargetCapability(targetRule.capability, argumentRule.targetCapabilities)) {
            continue;
        }
        matchedTargetRule = true;
        const targetIds = getTargetRuleValues(targetRule, arguments_);
        if (targetIds === null) {
            return null;
        }
        for (const targetId of targetIds) {
            const parentTrackId = resolveParentTrackId(targetRule.capability, targetId, context);
            if (parentTrackId === null) {
                return null;
            }
            parentTrackIds.add(parentTrackId);
        }
    }
    return matchedTargetRule && parentTrackIds.size > 0 ? [...parentTrackIds] : null;
};

const APP_DERIVED_MUTATION_IDENTITY_MATERIALIZERS = {
    parentTrackIds: materializeParentTrackIds,
} satisfies Record<AppDerivedMutationIdentityArgumentName, AppDerivedMutationIdentityMaterializer>;

function isAppDerivedMutationIdentityArgumentName(value: string): value is AppDerivedMutationIdentityArgumentName {
    return Object.hasOwn(APP_DERIVED_MUTATION_IDENTITY_MATERIALIZERS, value);
}

function materializeMutationIdentityArguments(input: {
    command: ToolCallResult;
    context: ProjectContext;
    mutationIdentityRules: readonly MutationIdentityRule[];
    targetRules: ExecutableAppActionGroundingRules['targetRules'];
}): { status: 'accepted'; arguments: Readonly<Record<string, unknown>> } | RejectedCompilation {
    const materializedArguments = materializeSidechainRouteIdentityArguments(input.command, input.context);
    for (const identityRule of input.mutationIdentityRules) {
        const identityArguments = [
            ...identityRule.arguments,
            ...('fallbackArguments' in identityRule && identityRule.fallbackArguments !== undefined
                ? identityRule.fallbackArguments
                : []),
        ];
        for (const argumentRule of identityArguments) {
            if (argumentRule.source !== 'app-derived') {
                continue;
            }
            const argumentName: string = argumentRule.argument;
            if (!isAppDerivedMutationIdentityArgumentName(argumentName)) {
                return {
                    status: 'rejected',
                    reason: `Structured command app-derived mutation identity is not registered: ${argumentName}`,
                };
            }
            const value = APP_DERIVED_MUTATION_IDENTITY_MATERIALIZERS[argumentName]({
                argumentRule,
                arguments_: materializedArguments,
                context: input.context,
                targetRules: input.targetRules,
            });
            if (value === null) {
                return {
                    status: 'rejected',
                    reason: `Structured command app-derived mutation identity could not be materialized: ${argumentName}`,
                };
            }
            materializedArguments[argumentName] = value;
        }
    }

    return { status: 'accepted', arguments: materializedArguments };
}

function getMutationIdentityLabel(
    mutationIdentityRules: readonly MutationIdentityRule[],
    arguments_: Readonly<Record<string, unknown>>
): string {
    const values: unknown[] = [];
    for (const rule of mutationIdentityRules) {
        if (rule.resourceReferenceOnly === true) {
            continue;
        }
        const expandedIdentityValues = getExpandedMutationIdentityValues(rule, arguments_);
        if (expandedIdentityValues !== null) {
            values.push(...expandedIdentityValues.flat());
        }
    }
    return values.length === 0 ? 'singleton resource' : values.join(',');
}

function checkCommandWriteConflict(input: {
    command: ToolCallResult;
    context: ProjectContext;
    mutationIdempotent: boolean;
    mutationIdentityRules: readonly MutationIdentityRule[];
    targetRules: ExecutableAppActionGroundingRules['targetRules'];
    mutationResourceWrites: Map<string, { destructive: boolean }>;
    targetCommandArguments: Map<string, string>;
    targetLabel: string;
}): { status: 'accepted'; commandKey: string } | RejectedCompilation {
    const commandKey = getCanonicalCommandIdentity(input.command);
    const materialization = materializeMutationIdentityArguments({
        command: input.command,
        context: input.context,
        mutationIdentityRules: input.mutationIdentityRules,
        targetRules: input.targetRules,
    });
    if (materialization.status === 'rejected') {
        return materialization;
    }
    const materializedArguments = materialization.arguments;
    const mutationWriteIdentities = getMutationWriteIdentities(
        input.command.name,
        input.mutationIdentityRules,
        materializedArguments
    );
    const mutationResourceWriteIdentities = getMutationResourceWriteIdentities(
        input.mutationIdentityRules,
        materializedArguments
    );
    if (mutationWriteIdentities === null || mutationResourceWriteIdentities === null) {
        return {
            status: 'rejected',
            reason: `Structured command mutation identity does not match the registered contract: ${input.command.name}`,
        };
    }
    if (
        mutationWriteIdentities.some((identity) => {
            const priorArguments = input.targetCommandArguments.get(identity);
            return priorArguments !== undefined && (!input.mutationIdempotent || priorArguments !== commandKey);
        })
    ) {
        return {
            status: 'rejected',
            reason: `Structured command writes for ${input.command.name} on ${input.targetLabel} are not safely composable.`,
        };
    }
    const destructive = /^remove|^delete/u.test(input.command.name);
    if (
        mutationResourceWriteIdentities.some((write) => {
            const priorWrite = input.mutationResourceWrites.get(write.identity);
            const currentDestructive = write.destructive ?? destructive;
            return priorWrite !== undefined && (currentDestructive || priorWrite.destructive);
        })
    ) {
        return {
            status: 'rejected',
            reason: 'Structured command list contains contradictory mutation resources.',
        };
    }
    for (const identity of mutationWriteIdentities) {
        input.targetCommandArguments.set(identity, commandKey);
    }
    for (const write of mutationResourceWriteIdentities) {
        input.mutationResourceWrites.set(write.identity, { destructive: write.destructive ?? destructive });
    }
    return { status: 'accepted', commandKey };
}

function stableTopologicalSort(
    items: readonly SemanticCommandListItem[]
): { status: 'accepted'; items: SemanticCommandListItem[] } | RejectedCompilation {
    const dependencies = new Map<string, string[]>();
    for (const item of items) {
        const id = item.id;
        if (!isSafeId(id) || dependencies.has(id)) {
            return {
                status: 'rejected',
                reason: 'Structured command list item IDs must be unique stable identifiers.',
            };
        }
        const dependsOn =
            item.dependsOn === undefined ? [] : parseIdList(item.dependsOn, 'Structured command dependencies');
        if ('status' in dependsOn) {
            return dependsOn;
        }
        dependencies.set(id, dependsOn);
    }
    if ([...dependencies.values()].some((itemDependencies) => itemDependencies.some((id) => !dependencies.has(id)))) {
        return { status: 'rejected', reason: 'Structured command list has an unknown dependency.' };
    }
    const remaining = new Set(items.map((item) => item.id));
    const sorted: SemanticCommandListItem[] = [];
    while (remaining.size > 0) {
        const next = items.find(
            (item) => remaining.has(item.id) && (dependencies.get(item.id) ?? []).every((id) => !remaining.has(id))
        );
        if (next === undefined) {
            return { status: 'rejected', reason: 'Structured command list has a cyclic dependency.' };
        }
        sorted.push(next);
        remaining.delete(next.id);
    }
    return { status: 'accepted', items: sorted };
}

const BATCH_LOCAL_BINDING_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;

function capabilityRequiresConcreteDependency(capability: string): boolean {
    return capability === 'device' || capability === 'device-parameter';
}

type BatchLocalBindingProducer = {
    capabilities: readonly string[];
    itemId: string;
};

const BATCH_LOCAL_BUS_TARGET_CAPABILITIES: ReadonlySet<string> = new Set([
    'track',
    'armable-track',
    'duplicable-track',
    'removable-track',
    'routable-source',
    'bus',
    'output',
    'device-host-track',
]);

function dependsTransitivelyOn(
    item: SemanticCommandListItem,
    dependencyId: string,
    itemsById: ReadonlyMap<string, SemanticCommandListItem>
): boolean {
    const visited = new Set<string>();
    const pending = [...(item.dependsOn ?? [])];
    while (pending.length > 0) {
        const candidateId = pending.pop();
        if (candidateId === undefined || visited.has(candidateId)) {
            continue;
        }
        if (candidateId === dependencyId) {
            return true;
        }
        visited.add(candidateId);
        pending.push(...(itemsById.get(candidateId)?.dependsOn ?? []));
    }
    return false;
}

function validateTargetArgumentsWithoutSelectors(input: {
    context: ProjectContext;
    item: SemanticCommandListItem;
    itemsById: ReadonlyMap<string, SemanticCommandListItem>;
    producersByBinding: ReadonlyMap<string, BatchLocalBindingProducer>;
    selectorArgument?: string;
    selectorStableIds?: readonly string[];
    targetRules: readonly {
        argument: string;
        allowBatchLocal?: boolean;
        capability: string;
        cardinality?: 'many';
        dependsOn?: string;
        distinctFrom?: string;
        optional?: boolean;
    }[];
}): { status: 'accepted'; directTargets: ArbitraryCommandListDirectTargetEvidence[] } | RejectedCompilation {
    const directTargets: ArbitraryCommandListDirectTargetEvidence[] = [];
    const stableIdsByArgument = new Map<string, readonly string[]>();
    if (input.selectorArgument !== undefined && input.selectorStableIds !== undefined) {
        stableIdsByArgument.set(input.selectorArgument, input.selectorStableIds);
    }
    for (const targetRule of input.targetRules) {
        if (targetRule.argument === input.selectorArgument) {
            continue;
        }
        const value = input.item.arguments[targetRule.argument];
        if (value === undefined && targetRule.optional) {
            continue;
        }
        if (typeof value === 'string' && value.startsWith('$')) {
            if (targetRule.cardinality === 'many' || targetRule.allowBatchLocal === false) {
                return { status: 'rejected', reason: 'Targeted command requires a bounded semantic bulk selector.' };
            }
            const binding = value.slice(1);
            if (!BATCH_LOCAL_BINDING_PATTERN.test(binding)) {
                return { status: 'rejected', reason: `Malformed batch-local target reference: ${value}` };
            }
            const producer = input.producersByBinding.get(binding);
            if (
                producer === undefined ||
                !producer.capabilities.includes(targetRule.capability) ||
                !dependsTransitivelyOn(input.item, producer.itemId, input.itemsById)
            ) {
                return {
                    status: 'rejected',
                    reason: `Batch-local target ${value} requires an earlier bounded producer dependency.`,
                };
            }
            continue;
        }
        if (input.selectorArgument === undefined) {
            return { status: 'rejected', reason: 'Targeted command requires a bounded semantic bulk selector.' };
        }
        let stableIds: string[];
        if (targetRule.cardinality === 'many') {
            const parsedIds = parseIdList(value, `Direct command target ${targetRule.argument}`);
            if ('status' in parsedIds || parsedIds.length === 0) {
                return 'status' in parsedIds
                    ? parsedIds
                    : {
                          status: 'rejected',
                          reason: `Direct command target ${targetRule.argument} must contain bounded stable IDs.`,
                      };
            }
            stableIds = parsedIds;
        } else if (isSafeId(value)) {
            stableIds = [value];
        } else {
            return {
                status: 'rejected',
                reason: `Direct command target ${targetRule.argument} must be one bounded stable ID.`,
            };
        }
        const dependencyIds =
            targetRule.dependsOn === undefined
                ? []
                : (stableIdsByArgument.get(targetRule.dependsOn) ??
                  (() => {
                      const dependencyValue = input.item.arguments[targetRule.dependsOn];
                      if (typeof dependencyValue === 'string' && !dependencyValue.startsWith('$')) {
                          return [dependencyValue];
                      }
                      if (Array.isArray(dependencyValue) && dependencyValue.every(isSafeId)) {
                          return dependencyValue;
                      }
                      return [];
                  })());
        if (
            targetRule.dependsOn !== undefined &&
            dependencyIds.length === 0 &&
            capabilityRequiresConcreteDependency(targetRule.capability)
        ) {
            return {
                status: 'rejected',
                reason: `Direct command target ${targetRule.argument} has no immutable dependency boundary.`,
            };
        }
        const isEligible = stableIds.every((stableId) =>
            (dependencyIds.length === 0 ? [undefined] : dependencyIds).every((dependencyId) =>
                isAgentReferenceCapabilityCandidate({
                    capability: targetRule.capability,
                    context: input.context,
                    ...(dependencyId === undefined ? {} : { dependencyId }),
                    id: stableId,
                })
            )
        );
        if (!isEligible) {
            return {
                status: 'rejected',
                reason: `Direct command target ${targetRule.argument} is outside the command capability contract.`,
            };
        }
        const distinctIds =
            targetRule.distinctFrom === undefined
                ? []
                : (stableIdsByArgument.get(targetRule.distinctFrom) ??
                  (isSafeId(input.item.arguments[targetRule.distinctFrom])
                      ? [input.item.arguments[targetRule.distinctFrom] as string]
                      : []));
        if (stableIds.some((stableId) => distinctIds.includes(stableId))) {
            return {
                status: 'rejected',
                reason: `Direct command target ${targetRule.argument} violates the distinct target contract.`,
            };
        }
        stableIdsByArgument.set(targetRule.argument, stableIds);
        directTargets.push({
            argument: targetRule.argument,
            capability: targetRule.capability,
            cardinality: targetRule.cardinality === 'many' ? 'many' : 'one',
            stableIds,
        });
    }
    return { status: 'accepted', directTargets };
}

function getDeclaredBatchLocalBinding(
    item: SemanticCommandListItem,
    repeat: number
): string | RejectedCompilation | null {
    const binding = item.arguments.binding;
    if (binding === undefined) {
        return null;
    }
    if (
        item.name !== 'createBus' ||
        typeof binding !== 'string' ||
        !BATCH_LOCAL_BINDING_PATTERN.test(binding) ||
        item.selector !== undefined ||
        repeat !== 1
    ) {
        return { status: 'rejected', reason: 'Batch-local binding producer is not one bounded createBus item.' };
    }
    return binding;
}

/**
 * Turns the provider's bounded semantic list into ordinary registered commands.
 * The provider never receives generated IDs, state guards, approval authority, or
 * a per-target execution turn; the snapshot is resolved exactly once here.
 */
export function compileArbitraryCommandList(input: {
    calls: readonly ToolCallResult[];
    context: ProjectContext;
    revision: string;
}): ArbitraryCommandListCompilation {
    const proposalCalls = input.calls.filter((call) => call.name === 'command.batch.propose');
    if (proposalCalls.length !== 1) {
        return { status: 'accepted', calls: [...input.calls], evidence: [], snapshotRevision: input.revision };
    }
    const proposal = proposalCalls[0]!;
    if (!isRecord(proposal.arguments) || proposal.arguments.list === undefined) {
        return { status: 'accepted', calls: [...input.calls], evidence: [], snapshotRevision: input.revision };
    }
    if (input.revision.length === 0) {
        return {
            status: 'rejected',
            reason: 'Structured command list requires a revision-bearing immutable project snapshot.',
        };
    }
    if (!hasOnlyKeys(proposal.arguments, ['list', 'plan']) || !isRecord(proposal.arguments.list)) {
        return {
            status: 'rejected',
            reason: 'Structured command list does not match the versioned application contract.',
        };
    }
    const plan = normalizeAgentPlanProposal(proposal.arguments.plan);
    const parsedList = parseSemanticCommandList(proposal.arguments.list);
    if (parsedList.status === 'rejected') {
        return parsedList;
    }
    const sortedItems = stableTopologicalSort(parsedList.value.items);
    if (sortedItems.status === 'rejected') {
        return sortedItems;
    }
    const items = sortedItems.items;
    const candidates = collectCandidates(input.context);
    const commands: ToolCallResult[] = [];
    const evidence: ArbitraryCommandListSelectorEvidence[] = [];
    const compiledItems: CompiledItemEvidence[] = [];
    const orderedTargetIds: string[] = [];
    const targetCommandArguments = new Map<string, string>();
    const mutationResourceWrites = new Map<string, { destructive: boolean }>();
    const canonicalCommandIndexByKey = new Map<string, number>();
    const itemsById = new Map(items.map((item) => [item.id, item]));
    const producersByBinding = new Map<string, BatchLocalBindingProducer>();

    for (const item of items) {
        const commandStart = commands.length;
        if (containsForbiddenProviderAuthority(item.arguments)) {
            return { status: 'rejected', reason: 'Provider supplied application-owned authority or expected state.' };
        }
        const rules = getExecutableAppActionGroundingRules(item.name);
        if (rules === null) {
            return {
                status: 'rejected',
                reason: `Structured command ${item.name} is not an executable catalog command.`,
            };
        }
        const dependsOn =
            item.dependsOn === undefined ? [] : parseIdList(item.dependsOn, 'Structured command dependencies');
        if ('status' in dependsOn) {
            return dependsOn;
        }
        const repeat = item.repeat?.count ?? 1;
        if (repeat < 1 || repeat > SEMANTIC_COMMAND_LIST_MAX_REPEAT) {
            return { status: 'rejected', reason: 'Structured command repetition exceeds the application bound.' };
        }
        const declaredBinding = getDeclaredBatchLocalBinding(item, repeat);
        if (isRecord(declaredBinding) && 'status' in declaredBinding) {
            return declaredBinding;
        }
        if (typeof declaredBinding === 'string' && producersByBinding.has(declaredBinding)) {
            return { status: 'rejected', reason: `Duplicate batch-local binding: ${declaredBinding}` };
        }
        if (item.selector === undefined) {
            const declaredCommandIdentities: string[] = [];
            let omittedCommandCount = 0;
            const representativeCommandIndexes: number[] = [];
            const targetValidation = validateTargetArgumentsWithoutSelectors({
                context: input.context,
                item,
                itemsById,
                producersByBinding,
                targetRules: rules.targetRules,
            });
            if (targetValidation.status === 'rejected') {
                return targetValidation;
            }
            for (let occurrence = 0; occurrence < repeat; occurrence += 1) {
                const command = { name: item.name, arguments: { ...item.arguments } };
                const writeCheck = checkCommandWriteConflict({
                    command,
                    context: input.context,
                    mutationIdempotent: rules.mutationIdempotent,
                    mutationIdentityRules: rules.mutationIdentityRules,
                    targetRules: rules.targetRules,
                    mutationResourceWrites,
                    targetCommandArguments,
                    targetLabel: getMutationIdentityLabel(rules.mutationIdentityRules, command.arguments),
                });
                if (writeCheck.status === 'rejected') {
                    return writeCheck;
                }
                const { commandKey } = writeCheck;
                declaredCommandIdentities.push(commandKey);
                const canonicalCommandIndex = canonicalCommandIndexByKey.get(commandKey);
                if (rules.mutationIdempotent && canonicalCommandIndex !== undefined) {
                    omittedCommandCount += 1;
                    representativeCommandIndexes.push(canonicalCommandIndex);
                    continue;
                }
                const commandIndex = commands.length;
                canonicalCommandIndexByKey.set(commandKey, commandIndex);
                representativeCommandIndexes.push(commandIndex);
                commands.push(command);
            }
            if (commands.length > SEMANTIC_COMMAND_LIST_MAX_COMMANDS) {
                return {
                    status: 'rejected',
                    reason: 'Structured command list exceeds the application command budget.',
                };
            }
            compiledItems.push({
                canonicalStableIds: [],
                declaredCommandIdentities,
                itemId: item.id,
                commandName: item.name,
                dependsOn,
                declaredCommandCount: repeat,
                omittedCommandCount,
                representativeCommandIndexes,
                stableIds: [],
                commandStart,
                commandCount: commands.length - commandStart,
            });
            if (typeof declaredBinding === 'string') {
                producersByBinding.set(declaredBinding, {
                    capabilities: [...BATCH_LOCAL_BUS_TARGET_CAPABILITIES],
                    itemId: item.id,
                });
            }
            continue;
        }
        const selector = item.selector;
        const targetRule = rules.targetRules.find((rule) => rule.argument === selector.targetArgument);
        if (targetRule === undefined) {
            return {
                status: 'rejected',
                reason: 'Bulk selector is incompatible with the discovered command target contract.',
            };
        }
        if (selector.targetArgument in item.arguments) {
            return { status: 'rejected', reason: 'Provider may not supply target IDs for a semantic bulk selector.' };
        }
        const resolved = resolveSelector({ candidates, selector, itemId: item.id });
        if ('status' in resolved) {
            return resolved;
        }
        const targetValidation = validateTargetArgumentsWithoutSelectors({
            context: input.context,
            item,
            itemsById,
            producersByBinding,
            selectorArgument: selector.targetArgument,
            selectorStableIds: resolved.stableIds,
            targetRules: rules.targetRules,
        });
        if (targetValidation.status === 'rejected') {
            return targetValidation;
        }
        const directTargetsByArgument = new Map(
            targetValidation.directTargets.map((directTarget) => [directTarget.argument, directTarget.stableIds])
        );
        const selectorDependencyIds =
            targetRule.dependsOn === undefined ? [] : (directTargetsByArgument.get(targetRule.dependsOn) ?? []);
        if (
            (targetRule.dependsOn !== undefined &&
                selectorDependencyIds.length === 0 &&
                capabilityRequiresConcreteDependency(targetRule.capability)) ||
            !resolved.stableIds.every((stableId) =>
                (selectorDependencyIds.length === 0 ? [undefined] : selectorDependencyIds).every((dependencyId) =>
                    isAgentReferenceCapabilityCandidate({
                        capability: targetRule.capability,
                        context: input.context,
                        ...(dependencyId === undefined ? {} : { dependencyId }),
                        id: stableId,
                    })
                )
            ) ||
            (targetRule.distinctFrom !== undefined &&
                resolved.stableIds.some((stableId) =>
                    (directTargetsByArgument.get(targetRule.distinctFrom!) ?? []).includes(stableId)
                ))
        ) {
            return {
                status: 'rejected',
                reason: 'Bulk selector resolved a target outside the command capability contract.',
            };
        }
        evidence.push(resolved.evidence);
        for (const rule of rules.targetRules) {
            const stableIds =
                rule.argument === selector.targetArgument
                    ? resolved.stableIds
                    : (directTargetsByArgument.get(rule.argument) ?? []);
            for (const stableId of stableIds) {
                if (!orderedTargetIds.includes(stableId)) {
                    orderedTargetIds.push(stableId);
                }
            }
        }
        if (repeat > 1 && !rules.mutationIdempotent) {
            return {
                status: 'rejected',
                reason: `Structured command repetition is not safely composable: ${item.name}`,
            };
        }
        const canonicalStableIds: string[] = [];
        const declaredCommandIdentities: string[] = [];
        let omittedCommandCount = 0;
        const representativeCommandIndexes: number[] = [];
        const selectedArgumentValues: Array<string | string[]> =
            targetRule.cardinality === 'many' ? [[...resolved.stableIds]] : [...resolved.stableIds];
        for (const selectedTarget of selectedArgumentValues) {
            for (let occurrence = 0; occurrence < repeat; occurrence += 1) {
                const command = {
                    name: item.name,
                    arguments: { ...item.arguments, [selector.targetArgument]: selectedTarget },
                };
                const writeCheck = checkCommandWriteConflict({
                    command,
                    context: input.context,
                    mutationIdempotent: rules.mutationIdempotent,
                    mutationIdentityRules: rules.mutationIdentityRules,
                    targetRules: rules.targetRules,
                    mutationResourceWrites,
                    targetCommandArguments,
                    targetLabel: resolved.stableIds.join(','),
                });
                if (writeCheck.status === 'rejected') {
                    return writeCheck;
                }
                const { commandKey } = writeCheck;
                declaredCommandIdentities.push(commandKey);
                const canonicalCommandIndex = canonicalCommandIndexByKey.get(commandKey);
                if (rules.mutationIdempotent && canonicalCommandIndex !== undefined) {
                    omittedCommandCount += 1;
                    representativeCommandIndexes.push(canonicalCommandIndex);
                    continue;
                }
                const commandIndex = commands.length;
                canonicalCommandIndexByKey.set(commandKey, commandIndex);
                representativeCommandIndexes.push(commandIndex);
                if (targetRule.cardinality === 'many') {
                    canonicalStableIds.push(...resolved.stableIds);
                } else {
                    canonicalStableIds.push(selectedTarget as string);
                }
                commands.push(command);
            }
        }
        if (commands.length > SEMANTIC_COMMAND_LIST_MAX_COMMANDS) {
            return { status: 'rejected', reason: 'Structured command list exceeds the application command budget.' };
        }
        compiledItems.push({
            canonicalStableIds,
            declaredCommandIdentities,
            itemId: item.id,
            commandName: item.name,
            dependsOn,
            declaredCommandCount: (targetRule.cardinality === 'many' ? 1 : resolved.stableIds.length) * repeat,
            omittedCommandCount,
            representativeCommandIndexes,
            stableIds: [...resolved.stableIds],
            commandStart,
            commandCount: commands.length - commandStart,
            targetArgument: selector.targetArgument,
            targetCapability: targetRule.capability,
            ...(targetRule.cardinality === 'many' ? { targetCardinality: 'many' as const } : {}),
            ...(targetValidation.directTargets.length === 0 ? {} : { directTargets: targetValidation.directTargets }),
        });
    }
    return {
        status: 'accepted',
        snapshotRevision: input.revision,
        evidence,
        compilerEvidence:
            plan === null
                ? undefined
                : {
                      schemaVersion: 1,
                      snapshotRevision: input.revision,
                      providerKnownTargetIds: [...orderedTargetIds],
                      selectors: structuredClone(evidence),
                      items: structuredClone(compiledItems),
                      commands: structuredClone(commands),
                  },
        calls: input.calls.map((call) =>
            call === proposal ? { name: call.name, arguments: { plan: proposal.arguments.plan, commands } } : call
        ),
    };
}
