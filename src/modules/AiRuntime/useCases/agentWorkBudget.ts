import { getVersionedCommandBatchEffects } from '#/modules/Command/useCases';

import { type MeasurementAdmitter, type MeasurementWork } from '../models/MeasurementBudget';

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
    actualRenderJobs?: number;
}): void {
    for (const estimate of input.estimates) {
        const consumed =
            estimate.category === 'maxRenderJobs' && input.actualRenderJobs !== undefined
                ? input.actualRenderJobs
                : estimate.amount;
        agentRunLifecycle.reconcileBudgetAttempt({
            runId: input.runId,
            attemptId: `${input.attemptId}:${estimate.category}`,
            consumed,
            mode: 'final',
            provenance: 'versioned-estimate',
        });
    }
}

/**
 * The admission a run grants its planner measurements. Each measurement reserves its renders and
 * reductions up front, under an attempt of its own, and trues both back to what ran once it settles.
 */
function createMeasurementAdmitter(runId: string): MeasurementAdmitter {
    return (planned) => {
        const measurementId = `measurement:${crypto.randomUUID()}`;
        const spends = [
            {
                attemptId: `${measurementId}:maxRenderJobs`,
                category: 'maxRenderJobs',
                estimate: planned.renderJobs,
                consumedBy: (actual: MeasurementWork) => actual.renderJobs,
            },
            {
                attemptId: `${measurementId}:localAnalysis`,
                category: 'localAnalysis',
                estimate: planned.analyses,
                consumedBy: (actual: MeasurementWork) => actual.analyses,
            },
        ];
        const reservation = agentRunLifecycle.reserveBudgetBatch({
            runId,
            attempts: spends.map(({ attemptId, category, estimate }) => ({
                attemptId,
                category,
                estimate,
                provenance: 'versioned-estimate',
            })),
        });
        if (reservation.status !== 'reserved') {
            return { status: 'refused', category: reservation.reason ?? 'agent budget limit' };
        }
        return {
            status: 'admitted',
            settle: (actual) => {
                for (const { attemptId, consumedBy } of spends) {
                    agentRunLifecycle.reconcileBudgetAttempt({
                        runId,
                        attemptId,
                        consumed: consumedBy(actual),
                        mode: 'final',
                        provenance: 'versioned-estimate',
                    });
                }
            },
        };
    };
}

export const agentWorkBudget = {
    admitMeasurement: createMeasurementAdmitter,
    reconcileCommandWork: reconcileAgentCommandWork,
    reserveCommandWork: reserveAgentCommandWork,
} as const;
