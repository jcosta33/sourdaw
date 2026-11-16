import { compileVersionedCommandBatchEnvelope, parseVersionedCommandEnvelope } from '#/modules/Command/useCases';
import { captureProjectIdentity } from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type ActionCommandGraph } from '../models/ActionCommandGraph';
import { type ProjectContext } from '../models/ProjectContext';

import { compilePendingActionCommandEnvelopes } from './compilePendingActionCommandEnvelopes';
import { type DynamicCommandEffects, proveDynamicCommandEffects } from './dynamicCommandEffectProvers';

type CompilePlannedActionCommandBatchInput = {
    actions: readonly AppAction[];
    actionCommandGraph?: ActionCommandGraph;
    actionLabels: readonly string[];
    autoCommit: boolean;
    autoCommitApproval?: Parameters<typeof compileVersionedCommandBatchEnvelope>[0]['autoCommitApproval'];
    group: { groupId: string; groupLabel: string };
    intent: string;
    mode?: 'commit' | 'preview';
    projectRevision: string;
    protectedTargetIds?: readonly string[];
    runId: string;
    context: ProjectContext;
};

function getDynamicEffects(input: CompilePlannedActionCommandBatchInput, commandEnvelopes: readonly string[]) {
    const aggregateAffectedTrackIds = new Set<string>();
    const aggregateAffectedClipIds = new Set<string>();
    const aggregateAffectedTargetIds = new Set<string>();
    let aggregateAutomationPoints = 0;
    let aggregateDeletedObjects = 0;
    const commandEffects: Array<{
        commandId: string;
        effects: {
            affectedTrackIds: string[];
            affectedClipIds: string[];
            affectedTargetIds: string[];
            automationPoints: number;
            deletedObjects: number;
        };
    }> = [];
    for (const [index, action] of input.actions.entries()) {
        const parsedCommand = parseVersionedCommandEnvelope(commandEnvelopes[index] ?? '');
        if (parsedCommand.status !== 'valid') {
            throw new Error(`Cannot prove dynamic bounds for ${action.type}`);
        }
        const commandId = parsedCommand.envelope.commandId;
        const effects: DynamicCommandEffects = {
            affectedTrackIds: new Set<string>(),
            affectedClipIds: new Set<string>(),
            affectedTargetIds: new Set<string>(),
            automationPoints: 0,
            deletedObjects: 0,
        };
        function recordDynamicEffects(): void {
            for (const id of effects.affectedTrackIds) {
                aggregateAffectedTrackIds.add(id);
            }
            for (const id of effects.affectedClipIds) {
                aggregateAffectedClipIds.add(id);
            }
            for (const id of effects.affectedTargetIds) {
                aggregateAffectedTargetIds.add(id);
            }
            aggregateAutomationPoints += effects.automationPoints;
            aggregateDeletedObjects += effects.deletedObjects;
            if (
                effects.affectedTrackIds.size === 0 &&
                effects.affectedClipIds.size === 0 &&
                effects.affectedTargetIds.size === 0 &&
                effects.automationPoints === 0 &&
                effects.deletedObjects === 0
            ) {
                return;
            }
            commandEffects.push({
                commandId,
                effects: {
                    affectedTrackIds: [...effects.affectedTrackIds],
                    affectedClipIds: [...effects.affectedClipIds],
                    affectedTargetIds: [...effects.affectedTargetIds],
                    automationPoints: effects.automationPoints,
                    deletedObjects: effects.deletedObjects,
                },
            });
        }
        proveDynamicCommandEffects({
            actionType: action.type,
            context: input.context,
            payload: parsedCommand.envelope.arguments,
            protectedTargetIds: input.protectedTargetIds,
            effects,
        });
        recordDynamicEffects();
    }
    return {
        affectedTrackIds: [...aggregateAffectedTrackIds],
        affectedClipIds: [...aggregateAffectedClipIds],
        affectedTargetIds: [...aggregateAffectedTargetIds],
        automationPoints: aggregateAutomationPoints,
        deletedObjects: aggregateDeletedObjects,
        commandEffects,
    };
}

export function compilePlannedActionCommandBatch(input: CompilePlannedActionCommandBatchInput) {
    const commandEnvelopes = compilePendingActionCommandEnvelopes({
        actions: input.actions,
        actionCommandGraph: input.actionCommandGraph,
        actionLabels: input.actionLabels,
        group: input.group,
        projectRevision: input.projectRevision,
    });
    const parsedCommands =
        (input.actionCommandGraph?.batchLocalBindings.length ?? 0) === 0
            ? []
            : commandEnvelopes.map((serialized) => {
                  const parsed = parseVersionedCommandEnvelope(serialized);
                  if (parsed.status !== 'valid') {
                      throw new Error(parsed.reason);
                  }
                  return parsed.envelope;
              });
    const batchLocalBindings = (input.actionCommandGraph?.batchLocalBindings ?? []).map((binding) => {
        const producer = parsedCommands[binding.producerActionIndex];
        if (
            producer === undefined ||
            !Number.isSafeInteger(binding.producerActionIndex) ||
            binding.producerActionIndex < 0
        ) {
            throw new Error('Action command graph contains an invalid batch-local producer');
        }
        return {
            bindingId: binding.bindingId,
            producerArgument: binding.producerArgument,
            producerCommandId: producer.commandId,
        };
    });
    return {
        commandEnvelopes,
        commandBatch: compileVersionedCommandBatchEnvelope({
            autoCommitApproval: input.autoCommitApproval,
            runId: input.runId,
            batchId: input.group.groupId,
            projectId: captureProjectIdentity(),
            baseRevision: input.projectRevision,
            batchLocalBindings,
            intent: input.intent,
            mode: input.mode,
            commands: commandEnvelopes,
            protectedTargetIds: input.protectedTargetIds,
            autoCommit: input.autoCommit,
            dynamicEffects: getDynamicEffects(input, commandEnvelopes),
        }),
    };
}
