import { type CommandBatchAuthority } from '../models/VersionedCommandBatchEnvelope';
import { type VersionedCommandEnvelope } from '../models/VersionedCommandEnvelope';

import { commandRequiresDynamicEffects } from './commandRequiresDynamicEffects';
import { compileVersionedCommandBatchEnvelope } from './compileVersionedCommandBatchEnvelope';
import { parseVersionedCommandBatchEnvelope } from './parseVersionedCommandBatchEnvelope';
import { serializeVersionedCommandEnvelope } from './serializeVersionedCommandEnvelope';

type CompilePartialCommandBatchAcceptanceInput = {
    authority: CommandBatchAuthority;
    batchId: string;
    runId: string;
    selectedIntentGroupIds: readonly string[];
    serialized: string;
};

function commandGroupId(command: VersionedCommandEnvelope): string {
    return command.commandId;
}

function selectedCommandClosure(
    commands: readonly VersionedCommandEnvelope[],
    selectedGroupIds: ReadonlySet<string>,
    bindingProducerById: ReadonlyMap<string, string>
): ReadonlySet<string> {
    const commandById = new Map(commands.map((command) => [command.commandId, command]));
    const includedGroupIds = new Set(selectedGroupIds);
    let changed = true;
    while (changed) {
        changed = false;
        for (const command of commands) {
            if (!includedGroupIds.has(commandGroupId(command))) {
                continue;
            }
            const requiredCommandIds = [
                ...command.dependencyIds,
                ...command.objectReferences.flatMap((reference) => {
                    if (reference.scope !== 'batch-local') {
                        return [];
                    }
                    const producerId = bindingProducerById.get(reference.id);
                    return producerId ? [producerId] : [];
                }),
            ];
            for (const requiredCommandId of requiredCommandIds) {
                const required = commandById.get(requiredCommandId);
                if (required && !includedGroupIds.has(commandGroupId(required))) {
                    includedGroupIds.add(commandGroupId(required));
                    changed = true;
                }
            }
        }
    }
    return includedGroupIds;
}

export function compilePartialCommandBatchAcceptance(input: CompilePartialCommandBatchAcceptanceInput) {
    if (input.selectedIntentGroupIds.length === 0) {
        return { status: 'rejected' as const, reason: 'Partial acceptance requires at least one intent group' };
    }
    const parsed = parseVersionedCommandBatchEnvelope(input.serialized, input.authority);
    if (parsed.status === 'invalid') {
        return { status: 'rejected' as const, reason: parsed.reason };
    }
    const envelope = parsed.envelope;
    if (envelope.mode !== 'preview') {
        return { status: 'rejected' as const, reason: 'Partial acceptance requires a preview batch' };
    }
    const availableGroupIds = new Set(envelope.commands.map(commandGroupId));
    const unknownGroupId = input.selectedIntentGroupIds.find((groupId) => !availableGroupIds.has(groupId));
    if (unknownGroupId) {
        return { status: 'rejected' as const, reason: `Unknown intent group: ${unknownGroupId}` };
    }
    const bindingProducerById = new Map(
        envelope.batchLocalBindings.map((binding) => [binding.bindingId, binding.producerCommandId])
    );
    const includedGroupIds = selectedCommandClosure(
        envelope.commands,
        new Set(input.selectedIntentGroupIds),
        bindingProducerById
    );
    const selectedCommands = envelope.commands.filter((command) => includedGroupIds.has(commandGroupId(command)));
    const selectedCommandIds = new Set(selectedCommands.map((command) => command.commandId));
    const commandIdMap = new Map(selectedCommands.map((command) => [command.commandId, crypto.randomUUID()]));
    const issuedAt = Date.now();
    const remappedCommands = selectedCommands.map((command, index) => ({
        ...command,
        commandId: commandIdMap.get(command.commandId)!,
        dependencyIds: command.dependencyIds
            .filter((dependencyId) => selectedCommandIds.has(dependencyId))
            .map((dependencyId) => commandIdMap.get(dependencyId)!),
        issuedAt: issuedAt + index,
        groupId: input.batchId,
    }));
    const usedBindingIds = new Set(
        selectedCommands.flatMap((command) =>
            command.objectReferences.flatMap((reference) => (reference.scope === 'batch-local' ? [reference.id] : []))
        )
    );
    const batchLocalBindings = envelope.batchLocalBindings.flatMap((binding) => {
        if (!usedBindingIds.has(binding.bindingId) || !selectedCommandIds.has(binding.producerCommandId)) {
            return [];
        }
        return [
            {
                ...binding,
                producerCommandId: commandIdMap.get(binding.producerCommandId)!,
            },
        ];
    });
    const hasDynamicEffects = remappedCommands.some((command) => commandRequiresDynamicEffects(command.operation));
    try {
        const compiled = compileVersionedCommandBatchEnvelope({
            baseRevision: envelope.baseRevision,
            batchId: input.batchId,
            batchLocalBindings,
            commands: remappedCommands.map(serializeVersionedCommandEnvelope),
            dynamicEffects: hasDynamicEffects
                ? {
                      automationPoints: envelope.budgets.maxAutomationPoints,
                      deletedObjects: envelope.budgets.maxDeletedObjects,
                  }
                : undefined,
            intent: envelope.intent,
            mode: 'commit',
            projectId: envelope.projectId,
            protectedRanges: envelope.scope.protectedRanges,
            protectedTargetIds: envelope.scope.protectedTargetIds,
            runId: input.runId,
        });
        return {
            status: 'compiled' as const,
            authority: compiled.authority,
            serialized: compiled.serialized,
            includedIntentGroupIds: selectedCommands.map((command) => command.commandId),
            includedOriginalCommandIds: selectedCommands.map((command) => command.commandId),
        };
    } catch (error) {
        return {
            status: 'rejected' as const,
            reason: error instanceof Error ? error.message : String(error),
        };
    }
}
