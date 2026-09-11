import { type VersionedCommandBatchEnvelope } from '../models/VersionedCommandBatchEnvelope';

import { commandBatchGroupId } from './commandBatchGroupId';
import { compileVersionedCommandBatchEnvelope } from './compileVersionedCommandBatchEnvelope';
import { getCommandBatchGroupDependencies } from './getCommandBatchGroupDependencies';
import { type PartialCommandBatchSelection, partialCommandBatchSelection } from './partialCommandBatchSelection';
import { serializeVersionedCommandEnvelope } from './serializeVersionedCommandEnvelope';

type CompilePartialCommandBatchAcceptanceInput = {
    batchId: string;
    previewSelection: PartialCommandBatchSelection;
    runId: string;
    selectedIntentGroupIds: readonly string[];
};

function selectedCommandClosure(
    envelope: VersionedCommandBatchEnvelope,
    selectedGroupIds: ReadonlySet<string>
): ReadonlySet<string> {
    const dependenciesByGroupId = getCommandBatchGroupDependencies(envelope);
    const includedGroupIds = new Set(selectedGroupIds);
    const pendingGroupIds = [...selectedGroupIds];
    while (pendingGroupIds.length > 0) {
        const groupId = pendingGroupIds.pop()!;
        for (const dependencyGroupId of dependenciesByGroupId.get(groupId) ?? []) {
            if (includedGroupIds.has(dependencyGroupId)) {
                continue;
            }
            includedGroupIds.add(dependencyGroupId);
            pendingGroupIds.push(dependencyGroupId);
        }
    }
    return includedGroupIds;
}

export function compilePartialCommandBatchAcceptance(input: CompilePartialCommandBatchAcceptanceInput) {
    if (input.selectedIntentGroupIds.length === 0) {
        return { status: 'rejected' as const, reason: 'Partial acceptance requires at least one intent group' };
    }
    const preview = partialCommandBatchSelection.read(input.previewSelection);
    if (!preview) {
        return { status: 'rejected' as const, reason: 'Partial acceptance requires a successful preview outcome' };
    }
    const envelope = preview.envelope;
    const unknownGroupId = input.selectedIntentGroupIds.find(
        (groupId) => !preview.availableIntentGroupIds.has(groupId)
    );
    if (unknownGroupId) {
        return { status: 'rejected' as const, reason: `Unknown intent group: ${unknownGroupId}` };
    }
    const includedGroupIds = selectedCommandClosure(envelope, new Set(input.selectedIntentGroupIds));
    const selectedCommands = envelope.commands.filter((command) => includedGroupIds.has(commandBatchGroupId(command)));
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
    const hasDynamicEffects = envelope.dynamicEffects !== undefined;
    const dynamicEffectsAreFullySelected = envelope.commands.every(
        (command) =>
            preview.availableIntentGroupIds.has(command.commandId) && includedGroupIds.has(commandBatchGroupId(command))
    );
    if (hasDynamicEffects && !dynamicEffectsAreFullySelected) {
        return {
            status: 'rejected' as const,
            reason: 'Partial acceptance cannot partition aggregate dynamic effects across intent groups',
        };
    }
    try {
        const compiled = compileVersionedCommandBatchEnvelope({
            baseRevision: envelope.baseRevision,
            batchId: input.batchId,
            batchLocalBindings,
            commands: remappedCommands.map(serializeVersionedCommandEnvelope),
            dynamicEffects: hasDynamicEffects ? envelope.dynamicEffects : undefined,
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
