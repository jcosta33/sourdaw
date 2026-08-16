import { getVersionedCommandBatchEffects } from '#/modules/Command/useCases';

import { agentRunLifecycle } from './agentRunLifecycle';

export type AgentWorkBudgetEstimate = {
    category: string;
    amount: number;
};

type CommandBatchWorkEnvelope = {
    commands: Parameters<typeof getVersionedCommandBatchEffects>[0];
    dynamicEffects?: Parameters<typeof getVersionedCommandBatchEffects>[1];
};

function estimateCommandBatchWork(envelope: CommandBatchWorkEnvelope): AgentWorkBudgetEstimate[] {
    const effects = getVersionedCommandBatchEffects(envelope.commands, envelope.dynamicEffects);
    return [
        { category: 'maxCommands', amount: envelope.commands.length },
        { category: 'maxRenderJobs', amount: effects.renderJobs },
        { category: 'maxImportedAssets', amount: effects.importedAssets },
        { category: 'maxAffectedTracks', amount: effects.affectedTrackIds.size },
        { category: 'maxAffectedClips', amount: effects.affectedClipIds.size },
        { category: 'maxAutomationPoints', amount: effects.automationPoints },
        { category: 'maxDeletedObjects', amount: effects.deletedObjects },
    ].filter((estimate) => estimate.amount > 0);
}

function reserveAgentCommandWork(input: { runId: string; envelope: CommandBatchWorkEnvelope; attemptId: string }): {
    status: 'reserved' | 'hard-limit-reached';
    reason?: string;
    estimates: AgentWorkBudgetEstimate[];
} {
    const estimates = estimateCommandBatchWork(input.envelope);
    const reservation = agentRunLifecycle.reserveBudgetBatch({
        runId: input.runId,
        attempts: estimates.map((estimate) => ({
            attemptId: `${input.attemptId}:${estimate.category}`,
            category: estimate.category,
            estimate: estimate.amount,
            provenance: 'versioned-estimate',
        })),
    });
    return { ...reservation, estimates };
}

function reconcileAgentCommandWork(input: {
    runId: string;
    attemptId: string;
    estimates: readonly AgentWorkBudgetEstimate[];
}): void {
    for (const estimate of input.estimates) {
        agentRunLifecycle.reconcileBudgetAttempt({
            runId: input.runId,
            attemptId: `${input.attemptId}:${estimate.category}`,
            consumed: estimate.amount,
            mode: 'final',
            provenance: 'versioned-estimate',
        });
    }
}

export const agentWorkBudget = {
    reconcileCommandWork: reconcileAgentCommandWork,
    reserveCommandWork: reserveAgentCommandWork,
} as const;
