import {
    migrateLegacyAppActionToVersionedCommandEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

type CompilePendingActionCommandEnvelopesInput = {
    actions: readonly AppAction[];
    actionLabels: readonly string[];
    group: { groupId: string; groupLabel: string };
    projectRevision: string;
};

export function compilePendingActionCommandEnvelopes(input: CompilePendingActionCommandEnvelopesInput): string[] {
    return input.actions.map((action, index) =>
        serializeVersionedCommandEnvelope(
            migrateLegacyAppActionToVersionedCommandEnvelope({
                action,
                expectedEffect: input.actionLabels[index] ?? action.type,
                normalizedProjectRevision: input.projectRevision,
                options: { ...input.group, source: 'prompt' },
            })
        )
    );
}
