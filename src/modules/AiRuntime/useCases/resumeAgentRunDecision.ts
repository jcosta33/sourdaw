import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { agentRunLifecycle } from './agentRunLifecycle';
import { getPlanningProviderSchemaContract } from './planningProviderSchema';
import { sendChatMessage } from './sendChatMessage';

function hasRemainingBudget(run: {
    budgets: { limits: Record<string, number>; consumed: Record<string, number> };
}): boolean {
    return Object.entries(run.budgets.limits).every(
        ([category, limit]) => (run.budgets.consumed[category] ?? 0) < limit
    );
}

function hasSameBoundAuthority(run: {
    scope: unknown;
    grants: unknown;
    budgets: unknown;
    decision: { scope: unknown; grants: unknown; budgets: unknown };
}): boolean {
    return (
        JSON.stringify(run.scope) === JSON.stringify(run.decision.scope) &&
        JSON.stringify(run.grants) === JSON.stringify(run.decision.grants) &&
        JSON.stringify(run.budgets) === JSON.stringify(run.decision.budgets)
    );
}

export async function resumeAgentRunDecision(input: {
    runId: string;
    alternativeId: string;
}): Promise<
    | { status: 'resumed'; sourceRunId: string; runId: string; decisionId: string; selectedAlternativeId: string }
    | { status: 'rejected'; reason: string }
> {
    const run = agentRunLifecycle.get(input.runId);
    if (
        run === null ||
        run.phase !== 'paused' ||
        run.cancellation.requestedAt !== null ||
        run.decision === null ||
        run.decision.selectedAlternativeId !== null
    ) {
        return { status: 'rejected', reason: 'The pending decision is unavailable or already consumed.' };
    }
    const decision = run.decision;
    if (captureProjectRevision() !== decision.revision) {
        return { status: 'rejected', reason: 'The project revision changed while the decision was pending.' };
    }
    if (!hasSameBoundAuthority({ ...run, decision })) {
        return {
            status: 'rejected',
            reason: 'The persisted decision authority or budget state no longer matches this run.',
        };
    }
    if (!hasRemainingBudget(run)) {
        return { status: 'rejected', reason: 'The remaining agent budget cannot admit another planning attempt.' };
    }
    if (getPlanningProviderSchemaContract().identity !== decision.capabilitySchemaIdentity) {
        return { status: 'rejected', reason: 'The provider capability schema changed while the decision was pending.' };
    }
    const selectedAlternative = decision.alternatives.find((alternative) => alternative.id === input.alternativeId);
    if (!selectedAlternative) {
        return { status: 'rejected', reason: 'The selected decision alternative is unavailable.' };
    }

    let resumedRunId: string | null = null;
    try {
        await sendChatMessage(run.request, {
            mode: run.mode,
            scope: decision.scope,
            grants: decision.grants,
            budgets: run.budgets,
            resume: {
                sourceRunId: run.runId,
                decisionId: decision.decisionId,
                selectedAlternativeId: selectedAlternative.id,
                selectedAlternative,
                proposalIdentity: decision.proposalIdentity,
                capabilitySchemaIdentity: decision.capabilitySchemaIdentity,
                revision: decision.revision,
                scope: decision.scope,
                grants: decision.grants,
                budgets: run.budgets,
            },
            onResumedRunAdmitted: (newRunId) => {
                agentRunLifecycle.selectDecisionAlternative({
                    runId: run.runId,
                    alternativeId: selectedAlternative.id,
                });
                resumedRunId = newRunId;
            },
        });
        if (resumedRunId === null) {
            return { status: 'rejected', reason: 'The replacement planning attempt was not admitted.' };
        }
        return {
            status: 'resumed',
            sourceRunId: run.runId,
            runId: resumedRunId,
            decisionId: decision.decisionId,
            selectedAlternativeId: selectedAlternative.id,
        };
    } catch (error) {
        return {
            status: 'rejected',
            reason: error instanceof Error ? error.message : 'The pending decision could not resume.',
        };
    }
}
