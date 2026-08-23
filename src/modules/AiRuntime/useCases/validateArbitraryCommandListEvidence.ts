import { getExecutableAppActionGroundingRules } from '#/modules/Command/useCases';

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

export type CompilerResolvedTargetOverride = {
    argument: string;
    capability: string;
    cardinality: 'one' | 'many';
    stableIds: string[];
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

/** Re-checks bounded, app-owned compiler proof at the bridge boundary before any grounding bypass. */
export function validateArbitraryCommandListEvidence(input: {
    evidence: ArbitraryCommandListEvidence;
    calls: readonly ToolCallResult[];
    context: ProjectContext;
    revision: string | undefined;
}):
    | { status: 'accepted'; targetOverridesByCallIndex: ReadonlyMap<number, readonly CompilerResolvedTargetOverride[]> }
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
    const resolvedTargetIds: string[] = [];
    const targetOverridesByCallIndex = new Map<number, readonly CompilerResolvedTargetOverride[]>();
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
        if (selector === undefined) {
            if (
                item.canonicalStableIds.length > 0 ||
                item.targetArgument !== undefined ||
                item.targetCapability !== undefined ||
                item.targetCardinality !== undefined
            ) {
                return {
                    status: 'rejected',
                    reason: 'Structured command compiler evidence target override is invalid.',
                };
            }
        } else {
            const groundingRules = getExecutableAppActionGroundingRules(item.commandName);
            const targetRule = groundingRules?.targetRules.find((rule) => rule.argument === item.targetArgument);
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
                !item.stableIds.every((stableId) =>
                    isAgentReferenceCapabilityCandidate({
                        capability: item.targetCapability!,
                        context: input.context,
                        id: stableId,
                    })
                )
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
        }
        itemIds.add(item.itemId);
        for (const stableId of item.stableIds) {
            if (!resolvedTargetIds.includes(stableId)) {
                resolvedTargetIds.push(stableId);
            }
        }
        commandCursor += item.commandCount;
    }
    if (
        commandCursor !== evidence.commands.length ||
        evidence.proposalScope.targetIds.length !== resolvedTargetIds.length ||
        !evidence.proposalScope.targetIds.every((stableId, index) => stableId === resolvedTargetIds[index])
    ) {
        return { status: 'rejected', reason: 'Structured command compiler evidence scope was enlarged or omitted.' };
    }
    return { status: 'accepted', targetOverridesByCallIndex };
}
