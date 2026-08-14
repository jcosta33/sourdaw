import { collaborationStore } from '#/modules/Collaboration/stores';
import {
    commandBatchPreflightPort,
    getVersionedCommandBatchDivergenceTargetIds,
    getAgentActionRiskPolicy,
    parseVersionedCommandBatchEnvelope,
} from '#/modules/Command/useCases';

import { getExactAgentActionHash } from './getExactAgentActionHash';

type PendingCommandBatch = {
    serialized: string;
    authority: Parameters<typeof parseVersionedCommandBatchEnvelope>[1];
};

type CompileAgentRiskApprovalInput = {
    commandBatch: PendingCommandBatch;
    requireExplicitApproval?: boolean;
    signals?: Parameters<typeof getAgentActionRiskPolicy>[0]['signals'];
};

function getLocalActorId(): string {
    return collaborationStore.value?.localPeerId ?? 'standalone';
}

export function compileAgentRiskApproval(input: CompileAgentRiskApprovalInput) {
    const parsed = parseVersionedCommandBatchEnvelope(input.commandBatch.serialized, input.commandBatch.authority);
    if (parsed.status === 'invalid') {
        throw new Error(parsed.reason);
    }
    const envelope = parsed.envelope;
    const applicationAssignedIds = new Set(
        envelope.commands.flatMap((command) => command.applicationAssignedIds.map((assigned) => assigned.value))
    );
    const targetIds = [
        ...new Set([
            ...getVersionedCommandBatchDivergenceTargetIds(envelope).filter(
                (targetId) => !applicationAssignedIds.has(targetId)
            ),
            ...envelope.scope.protectedTargetIds,
        ]),
    ];
    const preflight = commandBatchPreflightPort.capture({ assetReferences: [], targetIds });
    if (!preflight) {
        throw new Error('Command target fingerprint capture is unavailable.');
    }
    if (preflight.projectId !== envelope.projectId) {
        throw new Error('The command batch project identity is stale.');
    }
    const consequences = {
        audioUpload: envelope.grants.audioUpload,
        fileAccess: envelope.grants.file,
        maxImportedAssets: envelope.budgets.maxImportedAssets,
        maxRenderJobs: envelope.budgets.maxRenderJobs,
        remoteGeneration: envelope.grants.remoteGeneration,
    };
    const unexpectedlyBroad =
        input.signals?.unexpectedlyBroad === true ||
        envelope.commands.length > 1 ||
        envelope.budgets.maxAffectedTracks > 1 ||
        envelope.budgets.maxAffectedClips > 1;
    const registryPolicy = getAgentActionRiskPolicy({
        authorityEffects: {
            master: envelope.grants.master,
            routing: envelope.grants.routing,
            tempo: envelope.grants.tempo,
        },
        consequences,
        operationTypes: envelope.commands.map((command) => command.operation),
        signals: { ...input.signals, unexpectedlyBroad },
    });
    if (registryPolicy.decision === 'reject') {
        throw new Error(registryPolicy.reasons.join(' '));
    }
    let policy = registryPolicy;
    if (registryPolicy.decision === 'allow' && input.requireExplicitApproval !== false) {
        policy = {
            ...registryPolicy,
            decision: 'confirm',
            reasons: [...registryPolicy.reasons, 'The planning workflow requires explicit confirmation.'],
        };
    }
    return {
        schemaVersion: 1 as const,
        actionHashes: envelope.commands.map((command) =>
            getExactAgentActionHash({ operation: command.operation, arguments: command.arguments })
        ),
        sourceRevision: envelope.baseRevision,
        targetFingerprints: structuredClone(preflight.targetFingerprints),
        consequences,
        localActorId: getLocalActorId(),
        policy,
    };
}
