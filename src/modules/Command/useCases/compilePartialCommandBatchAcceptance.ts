import { type VersionedCommandEnvelope } from '../models/VersionedCommandEnvelope';

import { compileVersionedCommandBatchEnvelope } from './compileVersionedCommandBatchEnvelope';
import { type PartialCommandBatchSelection, partialCommandBatchSelection } from './partialCommandBatchSelection';
import { serializeVersionedCommandEnvelope } from './serializeVersionedCommandEnvelope';

type CompilePartialCommandBatchAcceptanceInput = {
    batchId: string;
    previewSelection: PartialCommandBatchSelection;
    runId: string;
    selectedIntentGroupIds: readonly string[];
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
    const hasDynamicEffects = envelope.dynamicEffects !== undefined;
    const dynamicEffectsAreFullySelected = envelope.commands.every(
        (command) =>
            preview.availableIntentGroupIds.has(command.commandId) && includedGroupIds.has(commandGroupId(command))
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
