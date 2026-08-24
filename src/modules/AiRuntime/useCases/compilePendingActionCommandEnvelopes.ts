import {
    migrateLegacyAppActionToVersionedCommandEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type ActionCommandGraph } from '../models/ActionCommandGraph';

type CompilePendingActionCommandEnvelopesInput = {
    actionCommandGraph?: ActionCommandGraph;
    actions: readonly AppAction[];
    actionLabels: readonly string[];
    group: { groupId: string; groupLabel: string };
    projectRevision: string;
};

export function compilePendingActionCommandEnvelopes(input: CompilePendingActionCommandEnvelopesInput): string[] {
    if (
        input.actionCommandGraph !== undefined &&
        input.actionCommandGraph.dependenciesByActionIndex.length !== input.actions.length
    ) {
        throw new Error('Action command graph does not exactly match the action batch');
    }
    const commandIds: string[] = [];
    return input.actions.map((action, index) => {
        const dependencyIndexes = input.actionCommandGraph?.dependenciesByActionIndex[index] ?? [];
        if (
            new Set(dependencyIndexes).size !== dependencyIndexes.length ||
            dependencyIndexes.some(
                (dependencyIndex) =>
                    !Number.isSafeInteger(dependencyIndex) || dependencyIndex < 0 || dependencyIndex >= index
            )
        ) {
            throw new Error('Action command graph contains an invalid or out-of-order dependency');
        }
        const envelope = migrateLegacyAppActionToVersionedCommandEnvelope({
            action,
            dependencyIds: dependencyIndexes.map((dependencyIndex) => commandIds[dependencyIndex]!),
            expectedEffect: input.actionLabels[index] ?? action.type,
            normalizedProjectRevision: input.projectRevision,
            options: { ...input.group, source: 'prompt' },
        });
        commandIds.push(envelope.commandId);
        return serializeVersionedCommandEnvelope(envelope);
    });
}
