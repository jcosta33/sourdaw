import { getExecutableAppActionGroundingRules } from '#/modules/Command/useCases';

import { type ActionCommandGraph } from '../models/ActionCommandGraph';
import { type ProjectContext } from '../models/ProjectContext';
import { type SemanticCommandListEntity } from '../models/SemanticCommandList';
import { type ToolCallResult } from '../transformers/toolCallParser';

import { isAgentReferenceCapabilityCandidate } from './agentReference/isAgentReferenceCapabilityCandidate';
import {
    type ArbitraryCommandListEvidence,
    type ArbitraryCommandListSelectorEvidence,
} from './compileArbitraryCommandList';

const MAX_COMMANDS = 32;

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

export type CompilerResolvedTargetOverride =
    | {
          argument: string;
          capability: string;
          cardinality: 'one' | 'many';
          stableIds: string[];
      }
    | {
          argument: string;
          batchLocalBinding: string;
          capability: string;
          cardinality: 'one';
      };

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

function sameToolCalls(left: readonly ToolCallResult[], right: readonly ToolCallResult[]): boolean {
    return (
        left.length === right.length &&
        left.every(
            (call, index) =>
                call.name === right[index]?.name &&
                JSON.stringify(call.arguments) === JSON.stringify(right[index]?.arguments)
        )
    );
}

function hasExactStableIdSet(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) {
        return false;
    }
    const leftIds = new Set(left);
    return leftIds.size === right.length && right.every((id) => leftIds.has(id));
}

function capabilityRequiresConcreteDependency(capability: string): boolean {
    return capability === 'device' || capability === 'device-parameter';
}

const BATCH_LOCAL_BINDING_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;

function evidenceDependsTransitivelyOn(
    itemId: string,
    dependencyId: string,
    itemsById: ReadonlyMap<string, ArbitraryCommandListEvidence['items'][number]>
): boolean {
    const visited = new Set<string>();
    const pending = [...(itemsById.get(itemId)?.dependsOn ?? [])];
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

/** Re-checks bounded, app-owned compiler proof at the bridge boundary before any grounding bypass. */
export function validateArbitraryCommandListEvidence(input: {
    evidence: ArbitraryCommandListEvidence;
    calls: readonly ToolCallResult[];
    context: ProjectContext;
    revision: string | undefined;
}):
    | {
          status: 'accepted';
          actionCommandGraph: ActionCommandGraph;
          targetOverridesByCallIndex: ReadonlyMap<number, readonly CompilerResolvedTargetOverride[]>;
      }
    | { status: 'rejected'; reason: string } {
    const { evidence } = input;
    if (evidence.schemaVersion !== 1 || input.revision !== evidence.snapshotRevision || input.revision === undefined) {
        return { status: 'rejected', reason: 'Structured command compiler evidence is stale.' };
    }
    if (
        !sameToolCalls(evidence.commands, input.calls) ||
        evidence.commands.length === 0 ||
        evidence.commands.length > MAX_COMMANDS
    ) {
        return {
            status: 'rejected',
            reason: 'Structured command compiler evidence does not exactly match the command batch.',
        };
    }
    const candidatesById = new Map(collectCandidates(input.context).map((candidate) => [candidate.id, candidate]));
    const protectedTargetIds = new Set(evidence.proposalScope.protectedTargetIds);
    const selectorByItemId = new Map<string, ArbitraryCommandListSelectorEvidence>();
    for (const selector of evidence.selectors) {
        if (selectorByItemId.has(selector.itemId) || selector.stableIds.length === 0) {
            return {
                status: 'rejected',
                reason: 'Structured command compiler evidence has duplicate or empty selectors.',
            };
        }
        if (
            new Set(selector.stableIds).size !== selector.stableIds.length ||
            selector.stableIds.some((stableId) => protectedTargetIds.has(stableId)) ||
            selector.preconditions.length !== selector.stableIds.length ||
            !selector.stableIds.every((stableId, index) => {
                const candidate = candidatesById.get(stableId);
                const precondition = selector.preconditions[index];
                return (
                    candidate !== undefined &&
                    precondition?.stableId === stableId &&
                    precondition.fingerprint === JSON.stringify(candidate)
                );
            }) ||
            selector.protectedExclusions.some((stableId) => !protectedTargetIds.has(stableId)) ||
            new Set(selector.excludedIds).size !== selector.excludedIds.length
        ) {
            return { status: 'rejected', reason: 'Structured command compiler evidence preconditions no longer hold.' };
        }
        selectorByItemId.set(selector.itemId, selector);
    }
    const itemIds = new Set<string>();
    const itemsById = new Map(evidence.items.map((item) => [item.itemId, item]));
    const resolvedTargetIds: string[] = [];
    const targetOverridesByCallIndex = new Map<number, readonly CompilerResolvedTargetOverride[]>();
    const producerByBinding = new Map<string, { commandIndex: number; itemId: string }>();
    let commandCursor = 0;
    for (const item of evidence.items) {
        if (
            itemIds.has(item.itemId) ||
            item.commandStart !== commandCursor ||
            !Number.isInteger(item.commandCount) ||
            item.commandCount < 0 ||
            !Number.isInteger(item.declaredCommandCount) ||
            item.declaredCommandCount < 1 ||
            !Number.isInteger(item.omittedCommandCount) ||
            item.omittedCommandCount < 0 ||
            item.declaredCommandCount !== item.commandCount + item.omittedCommandCount ||
            (item.targetCardinality !== undefined && item.targetCardinality !== 'many') ||
            item.dependsOn.some((dependency) => !itemIds.has(dependency))
        ) {
            return {
                status: 'rejected',
                reason: 'Structured command compiler evidence order or dependencies are invalid.',
            };
        }
        const selector = selectorByItemId.get(item.itemId);
        if (selector !== undefined && JSON.stringify(selector.stableIds) !== JSON.stringify(item.stableIds)) {
            return { status: 'rejected', reason: 'Structured command compiler evidence selector scope is invalid.' };
        }
        if (selector === undefined && item.stableIds.length > 0) {
            return { status: 'rejected', reason: 'Structured command compiler evidence contains unproven targets.' };
        }
        if (
            new Set(item.canonicalStableIds).size !== item.canonicalStableIds.length ||
            item.canonicalStableIds.some((stableId) => !item.stableIds.includes(stableId))
        ) {
            return { status: 'rejected', reason: 'Structured command compiler evidence canonicalization is invalid.' };
        }
        if (
            !evidence.commands
                .slice(item.commandStart, item.commandStart + item.commandCount)
                .every((command) => command.name === item.commandName)
        ) {
            return { status: 'rejected', reason: 'Structured command compiler evidence command order is invalid.' };
        }
        const groundingRules = getExecutableAppActionGroundingRules(item.commandName);
        if (groundingRules === null) {
            return {
                status: 'rejected',
                reason: 'Structured command compiler evidence target override is invalid.',
            };
        }
        const directTargets = item.directTargets ?? [];
        const directTargetsByArgument = new Map(directTargets.map((target) => [target.argument, target]));
        if (directTargetsByArgument.size !== directTargets.length) {
            return {
                status: 'rejected',
                reason: 'Structured command compiler evidence direct targets are invalid.',
            };
        }
        if (selector === undefined) {
            if (
                item.canonicalStableIds.length > 0 ||
                item.targetArgument !== undefined ||
                item.targetCapability !== undefined ||
                item.targetCardinality !== undefined ||
                directTargets.length > 0
            ) {
                return {
                    status: 'rejected',
                    reason: 'Structured command compiler evidence target override is invalid.',
                };
            }
        } else {
            const targetRule = groundingRules.targetRules.find((rule) => rule.argument === item.targetArgument);
            const stableIdsByArgument = new Map<string, readonly string[]>();
            if (item.targetArgument !== undefined) {
                stableIdsByArgument.set(item.targetArgument, item.stableIds);
            }
            for (const directTarget of directTargets) {
                stableIdsByArgument.set(directTarget.argument, directTarget.stableIds);
            }
            const selectorDependencyIds =
                targetRule?.dependsOn === undefined ? [] : (stableIdsByArgument.get(targetRule.dependsOn) ?? []);
            if (
                item.targetArgument === undefined ||
                item.targetCapability === undefined ||
                targetRule === undefined ||
                targetRule.capability !== item.targetCapability ||
                (targetRule.cardinality === 'many') !== (item.targetCardinality === 'many') ||
                (item.targetCardinality === 'many'
                    ? item.commandCount !== (item.canonicalStableIds.length === 0 ? 0 : 1) ||
                      (item.commandCount === 1 &&
                          JSON.stringify(item.canonicalStableIds) !== JSON.stringify(item.stableIds))
                    : item.commandCount !== item.canonicalStableIds.length) ||
                (targetRule.dependsOn !== undefined &&
                    selectorDependencyIds.length === 0 &&
                    capabilityRequiresConcreteDependency(targetRule.capability)) ||
                !item.stableIds.every((stableId) =>
                    (selectorDependencyIds.length === 0 ? [undefined] : selectorDependencyIds).every((dependencyId) =>
                        isAgentReferenceCapabilityCandidate({
                            capability: item.targetCapability!,
                            context: input.context,
                            ...(dependencyId === undefined ? {} : { dependencyId }),
                            id: stableId,
                        })
                    )
                ) ||
                (targetRule.distinctFrom !== undefined &&
                    item.stableIds.some((stableId) =>
                        (stableIdsByArgument.get(targetRule.distinctFrom!) ?? []).includes(stableId)
                    ))
            ) {
                return {
                    status: 'rejected',
                    reason: 'Structured command compiler evidence target override is invalid.',
                };
            }
            for (let offset = 0; offset < item.commandCount; offset += 1) {
                const commandIndex = item.commandStart + offset;
                const command = evidence.commands[commandIndex];
                let stableIds: string[];
                if (item.targetCardinality === 'many') {
                    stableIds = [...item.canonicalStableIds];
                } else {
                    const stableId = item.canonicalStableIds[offset];
                    stableIds = stableId === undefined ? [] : [stableId];
                }
                const commandTarget = command?.arguments[item.targetArgument];
                const targetMatches =
                    item.targetCardinality === 'many'
                        ? JSON.stringify(commandTarget) === JSON.stringify(stableIds)
                        : commandTarget === stableIds[0];
                if (stableIds.length === 0 || !targetMatches) {
                    return {
                        status: 'rejected',
                        reason: 'Structured command compiler evidence target order is invalid.',
                    };
                }
                targetOverridesByCallIndex.set(commandIndex, [
                    {
                        argument: item.targetArgument,
                        capability: item.targetCapability,
                        cardinality: item.targetCardinality === 'many' ? 'many' : 'one',
                        stableIds,
                    },
                ]);
            }
            const validatedDirectArguments = new Set<string>();
            for (const directRule of groundingRules.targetRules) {
                if (directRule.argument === item.targetArgument) {
                    continue;
                }
                const directTarget = directTargetsByArgument.get(directRule.argument);
                if (directTarget === undefined) {
                    const hasUnprovenStableTarget = evidence.commands
                        .slice(item.commandStart, item.commandStart + item.commandCount)
                        .some((command) => {
                            const value = command.arguments[directRule.argument];
                            return (
                                (typeof value === 'string' && !value.startsWith('$')) ||
                                (Array.isArray(value) && value.length > 0)
                            );
                        });
                    if (hasUnprovenStableTarget) {
                        return {
                            status: 'rejected',
                            reason: 'Structured command compiler evidence direct targets are invalid.',
                        };
                    }
                    continue;
                }
                const dependencyIds =
                    directRule.dependsOn === undefined ? [] : (stableIdsByArgument.get(directRule.dependsOn) ?? []);
                if (
                    directTarget.capability !== directRule.capability ||
                    directTarget.cardinality !== (directRule.cardinality === 'many' ? 'many' : 'one') ||
                    directTarget.stableIds.length === 0 ||
                    new Set(directTarget.stableIds).size !== directTarget.stableIds.length ||
                    directTarget.stableIds.some((stableId) => protectedTargetIds.has(stableId)) ||
                    (directRule.dependsOn !== undefined &&
                        dependencyIds.length === 0 &&
                        capabilityRequiresConcreteDependency(directRule.capability)) ||
                    !directTarget.stableIds.every((stableId) =>
                        (dependencyIds.length === 0 ? [undefined] : dependencyIds).every((dependencyId) =>
                            isAgentReferenceCapabilityCandidate({
                                capability: directTarget.capability,
                                context: input.context,
                                ...(dependencyId === undefined ? {} : { dependencyId }),
                                id: stableId,
                            })
                        )
                    ) ||
                    (directRule.distinctFrom !== undefined &&
                        directTarget.stableIds.some((stableId) =>
                            (stableIdsByArgument.get(directRule.distinctFrom!) ?? []).includes(stableId)
                        )) ||
                    !evidence.commands
                        .slice(item.commandStart, item.commandStart + item.commandCount)
                        .every((command) => {
                            const commandTarget = command.arguments[directRule.argument];
                            return directTarget.cardinality === 'many'
                                ? JSON.stringify(commandTarget) === JSON.stringify(directTarget.stableIds)
                                : commandTarget === directTarget.stableIds[0];
                        })
                ) {
                    return {
                        status: 'rejected',
                        reason: 'Structured command compiler evidence direct targets are invalid.',
                    };
                }
                validatedDirectArguments.add(directRule.argument);
            }
            if (validatedDirectArguments.size !== directTargets.length) {
                return {
                    status: 'rejected',
                    reason: 'Structured command compiler evidence direct targets are invalid.',
                };
            }
            for (let offset = 0; offset < item.commandCount; offset += 1) {
                const commandIndex = item.commandStart + offset;
                const selectorOverride = targetOverridesByCallIndex.get(commandIndex)?.[0];
                const overridesByArgument = new Map<string, CompilerResolvedTargetOverride>();
                if (selectorOverride !== undefined) {
                    overridesByArgument.set(selectorOverride.argument, selectorOverride);
                }
                for (const directTarget of directTargets) {
                    overridesByArgument.set(directTarget.argument, directTarget);
                }
                targetOverridesByCallIndex.set(
                    commandIndex,
                    groundingRules.targetRules.flatMap((rule) => {
                        const override = overridesByArgument.get(rule.argument);
                        return override === undefined ? [] : [override];
                    })
                );
            }
            for (const rule of groundingRules.targetRules) {
                const stableIds =
                    rule.argument === item.targetArgument
                        ? item.stableIds
                        : (directTargetsByArgument.get(rule.argument)?.stableIds ?? []);
                for (const stableId of stableIds) {
                    if (!resolvedTargetIds.includes(stableId)) {
                        resolvedTargetIds.push(stableId);
                    }
                }
            }
        }
        const itemCommands = evidence.commands.slice(item.commandStart, item.commandStart + item.commandCount);
        for (const targetRule of groundingRules.targetRules) {
            for (const [offset, command] of itemCommands.entries()) {
                const target = command.arguments[targetRule.argument];
                if (typeof target !== 'string' || !target.startsWith('$')) {
                    continue;
                }
                const binding = target.slice(1);
                const producer = producerByBinding.get(binding);
                if (
                    targetRule.cardinality === 'many' ||
                    targetRule.allowBatchLocal === false ||
                    !BATCH_LOCAL_BINDING_PATTERN.test(binding) ||
                    producer === undefined ||
                    !evidenceDependsTransitivelyOn(item.itemId, producer.itemId, itemsById)
                ) {
                    return {
                        status: 'rejected',
                        reason: 'Structured command compiler evidence batch-local target is invalid.',
                    };
                }
                const commandIndex = item.commandStart + offset;
                const overrides = targetOverridesByCallIndex.get(commandIndex) ?? [];
                targetOverridesByCallIndex.set(commandIndex, [
                    ...overrides.filter((override) => override.argument !== targetRule.argument),
                    {
                        argument: targetRule.argument,
                        batchLocalBinding: binding,
                        capability: targetRule.capability,
                        cardinality: 'one',
                    },
                ]);
            }
        }
        if (item.commandName === 'createBus') {
            const binding = itemCommands[0]?.arguments.binding;
            if (binding !== undefined) {
                if (
                    itemCommands.length !== 1 ||
                    typeof binding !== 'string' ||
                    !BATCH_LOCAL_BINDING_PATTERN.test(binding) ||
                    producerByBinding.has(binding)
                ) {
                    return {
                        status: 'rejected',
                        reason: 'Structured command compiler evidence batch-local producer is invalid.',
                    };
                }
                producerByBinding.set(binding, { commandIndex: item.commandStart, itemId: item.itemId });
            }
        }
        itemIds.add(item.itemId);
        commandCursor += item.commandCount;
    }
    if (
        commandCursor !== evidence.commands.length ||
        !hasExactStableIdSet(evidence.proposalScope.targetIds, resolvedTargetIds)
    ) {
        return { status: 'rejected', reason: 'Structured command compiler evidence scope was enlarged or omitted.' };
    }
    const dependenciesByActionIndex = evidence.commands.map((): number[] => []);
    const commandIndexesByItemId = new Map(
        evidence.items.map((item) => [
            item.itemId,
            Array.from({ length: item.commandCount }, (_unused, offset) => item.commandStart + offset),
        ])
    );
    const resolveDependencyIndexes = (itemId: string, visited = new Set<string>()): number[] => {
        if (visited.has(itemId)) {
            return [];
        }
        visited.add(itemId);
        const commandIndexes = commandIndexesByItemId.get(itemId) ?? [];
        if (commandIndexes.length > 0) {
            return commandIndexes;
        }
        return (itemsById.get(itemId)?.dependsOn ?? []).flatMap((dependencyId) =>
            resolveDependencyIndexes(dependencyId, visited)
        );
    };
    for (const item of evidence.items) {
        const dependencyIndexes = [
            ...new Set(item.dependsOn.flatMap((dependencyId) => resolveDependencyIndexes(dependencyId))),
        ];
        for (const commandIndex of commandIndexesByItemId.get(item.itemId) ?? []) {
            dependenciesByActionIndex[commandIndex] = dependencyIndexes;
        }
    }
    return {
        status: 'accepted',
        actionCommandGraph: {
            dependenciesByActionIndex,
            batchLocalBindings: [...producerByBinding.entries()].map(([binding, producer]) => ({
                bindingId: `$${binding}`,
                producerActionIndex: producer.commandIndex,
                producerArgument: 'busId',
            })),
        },
        targetOverridesByCallIndex,
    };
}
