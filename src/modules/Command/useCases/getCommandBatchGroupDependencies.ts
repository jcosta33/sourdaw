import { type VersionedCommandBatchEnvelope } from '../models/VersionedCommandBatchEnvelope';

import { commandBatchGroupId } from './commandBatchGroupId';

/**
 * The one prerequisite relation between intent groups: declared dependencies plus the
 * producers of batch-local object references. Partial acceptance walks its transitive
 * closure to decide what a selection drags in, and the approval view shows the same edges,
 * so a group the view calls independent can never be silently pulled into a subset.
 */
export function getCommandBatchGroupDependencies(
    envelope: VersionedCommandBatchEnvelope
): ReadonlyMap<string, readonly string[]> {
    const commandById = new Map(envelope.commands.map((command) => [command.commandId, command]));
    const bindingProducerById = new Map(
        envelope.batchLocalBindings.map((binding) => [binding.bindingId, binding.producerCommandId])
    );
    const dependenciesByGroupId = new Map<string, readonly string[]>();
    for (const command of envelope.commands) {
        const groupId = commandBatchGroupId(command);
        const requiredCommandIds = [
            ...command.dependencyIds,
            ...command.objectReferences.flatMap((reference) => {
                if (reference.scope !== 'batch-local') {
                    return [];
                }
                const producerCommandId = bindingProducerById.get(reference.id);
                return producerCommandId ? [producerCommandId] : [];
            }),
        ];
        const dependsOnGroupIds = new Set<string>();
        for (const requiredCommandId of requiredCommandIds) {
            const required = commandById.get(requiredCommandId);
            if (!required) {
                continue;
            }
            const requiredGroupId = commandBatchGroupId(required);
            if (requiredGroupId === groupId) {
                continue;
            }
            dependsOnGroupIds.add(requiredGroupId);
        }
        dependenciesByGroupId.set(groupId, [...dependsOnGroupIds].sort());
    }
    return dependenciesByGroupId;
}
