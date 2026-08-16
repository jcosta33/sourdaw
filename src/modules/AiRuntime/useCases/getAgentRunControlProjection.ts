import { type AgentExecutionMode } from '../models/AgentExecutionMode';
import { type AgentRunError, type AgentRunPhase } from '../models/AgentRun';
import { readAgentRunState } from '../stores/agentRunStore';

import { agentRunLifecycle } from './agentRunLifecycle';
import { resumeAgentRunDecision } from './resumeAgentRunDecision';

type AgentRunControlProjection = {
    runId: string;
    schemaVersion: 1;
    mode: AgentExecutionMode;
    phase: AgentRunPhase;
    request: string;
    cancellation: {
        requested: boolean;
        acknowledgement: 'none' | 'consumer-only' | 'transport' | 'backend';
    };
    allowedActions: {
        cancel: boolean;
        resume: boolean;
        retryWorkIds: string[];
    };
    manualResumeReason: string | null;
    committedReceipts: Array<{
        workId: string;
        receiptIdentity: string;
        revertGroupId: string | null;
    }>;
    errors: AgentRunError[];
};

const TERMINAL_PHASES = new Set<AgentRunPhase>(['completed', 'failed', 'cancelled', 'partially-completed']);

function getAgentRunControlProjection(runId: string): AgentRunControlProjection | null {
    const run = agentRunLifecycle.get(runId);
    if (!run) {
        return null;
    }
    const acknowledgement = (() => {
        if (run.cancellation.backendAcknowledgedAt !== null) {
            return 'backend' as const;
        }
        if (run.cancellation.transportAcknowledgedAt !== null) {
            return 'transport' as const;
        }
        if (run.cancellation.consumerAcknowledgedAt !== null) {
            return 'consumer-only' as const;
        }
        return 'none' as const;
    })();
    const retryWorkIds = run.retriableWork
        .filter(
            (work) =>
                run.cancellation.requestedAt === null &&
                run.phase !== 'completed' &&
                run.phase !== 'cancelled' &&
                work.idempotent &&
                work.retriable &&
                run.workLeases.some(
                    (lease) =>
                        lease.workId === work.workId &&
                        (lease.terminalState === 'failed' || lease.terminalState === 'orphaned')
                )
        )
        .map((work) => work.workId);
    const canResumeDecision =
        run.phase === 'paused' &&
        run.cancellation.requestedAt === null &&
        run.decision !== null &&
        run.decision.selectedAlternativeId === null &&
        run.decision.alternatives.length > 0 &&
        JSON.stringify(run.decision.scope) === JSON.stringify(run.scope) &&
        JSON.stringify(run.decision.grants) === JSON.stringify(run.grants);
    return {
        runId: run.runId,
        schemaVersion: run.schemaVersion,
        mode: run.mode,
        phase: run.phase,
        request: run.request,
        cancellation: {
            requested: run.cancellation.requestedAt !== null,
            acknowledgement,
        },
        allowedActions: {
            cancel: !TERMINAL_PHASES.has(run.phase),
            resume: canResumeDecision,
            retryWorkIds,
        },
        manualResumeReason: run.manualResume.reason,
        committedReceipts: run.committedWork.map((work) => ({
            workId: work.workId,
            receiptIdentity: work.receiptIdentity,
            revertGroupId: work.revertGroupId,
        })),
        errors: structuredClone(run.errors),
    };
}

function getAgentRunControlProjections(): AgentRunControlProjection[] {
    return readAgentRunState()
        .runs.toSorted((left, right) => right.updatedAt - left.updatedAt)
        .flatMap((run) => {
            const projection = getAgentRunControlProjection(run.runId);
            return projection ? [projection] : [];
        });
}

export const agentRunControls = {
    get: getAgentRunControlProjection,
    list: getAgentRunControlProjections,
    resumeDecision: resumeAgentRunDecision,
} as const;
