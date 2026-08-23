import { getExecutableAppActionGroundingRules } from '#/modules/Command/useCases';
import { getSidechainTargetCapability } from '#/modules/Routing/useCases';

import { type AgentPlanProposal } from '../models/AgentRun';
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

type CompiledItemEvidence = {
    canonicalStableIds: string[];
    itemId: string;
    commandName: string;
    dependsOn: string[];
    declaredCommandCount: number;
    omittedCommandCount: number;
    stableIds: string[];
    commandStart: number;
    commandCount: number;
    targetArgument?: string;
    targetCapability?: string;
    targetCardinality?: 'many';
};

export type ArbitraryCommandListEvidence = {
    schemaVersion: 1;
    snapshotRevision: string;
    proposalScope: AgentPlanProposal['scope'];
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
    protectedTargetIds: ReadonlySet<string>;
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
    const excludedIds = new Set([...explicitlyExcludedIds, ...input.protectedTargetIds]);
    const protectedExclusions = candidates
        .filter((candidate) => input.protectedTargetIds.has(candidate.id))
        .map((candidate) => candidate.id);
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
            protectedExclusions,
            preconditions: stableIds.map((stableId) => {
                const candidate = candidates.find((entry) => entry.id === stableId);
                return { stableId, fingerprint: JSON.stringify(candidate) };
            }),
        },
    };
}

function hasExactScope(plan: ReturnType<typeof normalizeAgentPlanProposal>, stableIds: readonly string[]): boolean {
    return (
        plan !== null &&
        plan.scope.targetIds.length === stableIds.length &&
        plan.scope.targetIds.every((id, index) => id === stableIds[index])
    );
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

type MutationIdentityRule = {
    arguments: readonly { argument: string; cardinality?: 'many' }[];
    fallbackArguments?: readonly { argument: string; cardinality?: 'many' }[];
};

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

function materializeMutationIdentityArguments(
    command: ToolCallResult,
    context: ProjectContext
): Readonly<Record<string, unknown>> {
    if (command.name !== 'addSidechainRoute' || command.arguments.targetDeviceId !== undefined) {
        return command.arguments;
    }
    const targetTrackId = command.arguments.targetTrackId;
    if (typeof targetTrackId !== 'string') {
        return command.arguments;
    }
    const supportedTargetDeviceIds =
        context.tracks
            .find((track) => track.id === targetTrackId)
            ?.devices.filter((device) => getSidechainTargetCapability(device.type) !== null)
            .map((device) => device.id) ?? [];
    if (supportedTargetDeviceIds.length !== 1) {
        return command.arguments;
    }
    return { ...command.arguments, targetDeviceId: supportedTargetDeviceIds[0] };
}

function getMutationIdentityLabel(
    mutationIdentityRules: readonly MutationIdentityRule[],
    arguments_: Readonly<Record<string, unknown>>
): string {
    const values: unknown[] = [];
    for (const rule of mutationIdentityRules) {
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
    targetCommandArguments: Map<string, string>;
    targetLabel: string;
}): { status: 'accepted'; commandKey: string } | RejectedCompilation {
    const commandKey = getCanonicalCommandIdentity(input.command);
    const mutationWriteIdentities = getMutationWriteIdentities(
        input.command.name,
        input.mutationIdentityRules,
        materializeMutationIdentityArguments(input.command, input.context)
    );
    if (mutationWriteIdentities === null) {
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
    for (const identity of mutationWriteIdentities) {
        input.targetCommandArguments.set(identity, commandKey);
    }
    return { status: 'accepted', commandKey };
}

function detectDependencyCycle(items: readonly SemanticCommandListItem[]): string | null {
    const dependencies = new Map<string, string[]>();
    for (const item of items) {
        const id = item.id;
        if (!isSafeId(id) || dependencies.has(id)) {
            return 'Structured command list item IDs must be unique stable identifiers.';
        }
        const dependsOn =
            item.dependsOn === undefined ? [] : parseIdList(item.dependsOn, 'Structured command dependencies');
        if ('status' in dependsOn) {
            return dependsOn.reason;
        }
        dependencies.set(id, dependsOn);
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): boolean => {
        if (visiting.has(id)) {
            return true;
        }
        if (visited.has(id)) {
            return false;
        }
        visiting.add(id);
        const cycle = (dependencies.get(id) ?? []).some(
            (dependency) => !dependencies.has(dependency) || visit(dependency)
        );
        visiting.delete(id);
        visited.add(id);
        return cycle;
    };
    return [...dependencies.keys()].some(visit) ? 'Structured command list has an unknown or cyclic dependency.' : null;
}

const BATCH_LOCAL_BINDING_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;

type BatchLocalBindingProducer = {
    itemId: string;
};

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
    item: SemanticCommandListItem;
    itemsById: ReadonlyMap<string, SemanticCommandListItem>;
    producersByBinding: ReadonlyMap<string, BatchLocalBindingProducer>;
    selectorArgument?: string;
    targetRules: readonly {
        argument: string;
        allowBatchLocal?: boolean;
        cardinality?: 'many';
        optional?: boolean;
    }[];
}): RejectedCompilation | null {
    for (const targetRule of input.targetRules) {
        if (targetRule.argument === input.selectorArgument) {
            continue;
        }
        const value = input.item.arguments[targetRule.argument];
        if (value === undefined && targetRule.optional) {
            continue;
        }
        if (input.selectorArgument !== undefined && (typeof value !== 'string' || !value.startsWith('$'))) {
            continue;
        }
        if (
            typeof value !== 'string' ||
            !value.startsWith('$') ||
            targetRule.cardinality === 'many' ||
            targetRule.allowBatchLocal === false
        ) {
            return { status: 'rejected', reason: 'Targeted command requires a bounded semantic bulk selector.' };
        }
        const binding = value.slice(1);
        if (!BATCH_LOCAL_BINDING_PATTERN.test(binding)) {
            return { status: 'rejected', reason: `Malformed batch-local target reference: ${value}` };
        }
        const producer = input.producersByBinding.get(binding);
        if (producer === undefined || !dependsTransitivelyOn(input.item, producer.itemId, input.itemsById)) {
            return {
                status: 'rejected',
                reason: `Batch-local target ${value} requires an earlier bounded producer dependency.`,
            };
        }
    }
    return null;
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
    const items = parsedList.value.items;
    const dependencyRejection = detectDependencyCycle(items);
    if (dependencyRejection !== null) {
        return { status: 'rejected', reason: dependencyRejection };
    }
    const candidates = collectCandidates(input.context);
    const protectedTargetIds = new Set(plan?.scope.protectedTargetIds ?? []);
    const commands: ToolCallResult[] = [];
    const evidence: ArbitraryCommandListSelectorEvidence[] = [];
    const compiledItems: CompiledItemEvidence[] = [];
    const orderedTargetIds: string[] = [];
    const targetWrites = new Map<string, { destructive: boolean; itemId: string }>();
    const targetCommandArguments = new Map<string, string>();
    const canonicalCommandKeys = new Set<string>();
    const itemsById = new Map(items.map((item) => [item.id, item]));
    const producersByBinding = new Map<string, BatchLocalBindingProducer>();

    for (const [index, item] of items.entries()) {
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
        const priorIds = new Set(items.slice(0, index).map((entry) => entry.id));
        if (dependsOn.some((dependency) => !priorIds.has(dependency))) {
            return {
                status: 'rejected',
                reason: 'Structured command dependencies must refer to earlier ordered items.',
            };
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
            let omittedCommandCount = 0;
            const targetRejection = validateTargetArgumentsWithoutSelectors({
                item,
                itemsById,
                producersByBinding,
                targetRules: rules.targetRules,
            });
            if (targetRejection !== null) {
                return targetRejection;
            }
            for (let occurrence = 0; occurrence < repeat; occurrence += 1) {
                const command = { name: item.name, arguments: { ...item.arguments } };
                const writeCheck = checkCommandWriteConflict({
                    command,
                    context: input.context,
                    mutationIdempotent: rules.mutationIdempotent,
                    mutationIdentityRules: rules.mutationIdentityRules,
                    targetCommandArguments,
                    targetLabel: getMutationIdentityLabel(rules.mutationIdentityRules, command.arguments),
                });
                if (writeCheck.status === 'rejected') {
                    return writeCheck;
                }
                const { commandKey } = writeCheck;
                if (rules.mutationIdempotent && canonicalCommandKeys.has(commandKey)) {
                    omittedCommandCount += 1;
                    continue;
                }
                canonicalCommandKeys.add(commandKey);
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
                itemId: item.id,
                commandName: item.name,
                dependsOn,
                declaredCommandCount: repeat,
                omittedCommandCount,
                stableIds: [],
                commandStart,
                commandCount: commands.length - commandStart,
            });
            if (typeof declaredBinding === 'string') {
                producersByBinding.set(declaredBinding, { itemId: item.id });
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
        const targetRejection = validateTargetArgumentsWithoutSelectors({
            item,
            itemsById,
            producersByBinding,
            selectorArgument: selector.targetArgument,
            targetRules: rules.targetRules,
        });
        if (targetRejection !== null) {
            return targetRejection;
        }
        const resolved = resolveSelector({ candidates, selector, protectedTargetIds, itemId: item.id });
        if ('status' in resolved) {
            return resolved;
        }
        if (
            !resolved.stableIds.every((stableId) =>
                isAgentReferenceCapabilityCandidate({
                    capability: targetRule.capability,
                    context: input.context,
                    id: stableId,
                })
            )
        ) {
            return {
                status: 'rejected',
                reason: 'Bulk selector resolved a target outside the command capability contract.',
            };
        }
        evidence.push(resolved.evidence);
        for (const stableId of resolved.stableIds) {
            if (!orderedTargetIds.includes(stableId)) {
                orderedTargetIds.push(stableId);
            }
        }
        if (repeat > 1 && !rules.mutationIdempotent) {
            return {
                status: 'rejected',
                reason: `Structured command repetition is not safely composable: ${item.name}`,
            };
        }
        const canonicalStableIds: string[] = [];
        let omittedCommandCount = 0;
        const isDestructive = /^remove|^delete/u.test(item.name);
        for (const stableId of resolved.stableIds) {
            const previousWrite = targetWrites.get(stableId);
            if (previousWrite && (isDestructive || previousWrite.destructive) && previousWrite.itemId !== item.id) {
                return {
                    status: 'rejected',
                    reason: 'Structured command list contains contradictory target dependencies.',
                };
            }
            targetWrites.set(stableId, { destructive: isDestructive, itemId: item.id });
        }
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
                    targetCommandArguments,
                    targetLabel: resolved.stableIds.join(','),
                });
                if (writeCheck.status === 'rejected') {
                    return writeCheck;
                }
                const { commandKey } = writeCheck;
                if (rules.mutationIdempotent && canonicalCommandKeys.has(commandKey)) {
                    omittedCommandCount += 1;
                    continue;
                }
                canonicalCommandKeys.add(commandKey);
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
            itemId: item.id,
            commandName: item.name,
            dependsOn,
            declaredCommandCount: (targetRule.cardinality === 'many' ? 1 : resolved.stableIds.length) * repeat,
            omittedCommandCount,
            stableIds: [...resolved.stableIds],
            commandStart,
            commandCount: commands.length - commandStart,
            targetArgument: selector.targetArgument,
            targetCapability: targetRule.capability,
            ...(targetRule.cardinality === 'many' ? { targetCardinality: 'many' as const } : {}),
        });
    }
    if (!hasExactScope(plan, orderedTargetIds)) {
        return {
            status: 'rejected',
            reason: 'Structured command list resolved scope does not exactly match the provider proposal.',
        };
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
                      proposalScope: structuredClone(plan.scope),
                      selectors: structuredClone(evidence),
                      items: structuredClone(compiledItems),
                      commands: structuredClone(commands),
                  },
        calls: input.calls.map((call) =>
            call === proposal ? { name: call.name, arguments: { plan: proposal.arguments.plan, commands } } : call
        ),
    };
}
