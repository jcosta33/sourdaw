import { agentRunLifecycle } from './agentRunLifecycle';
import { getAgentRunDecisionResumeAdmission } from './getAgentRunDecisionResumeAdmission';
import { sendChatMessage } from './sendChatMessage';

export async function resumeAgentRunDecision(input: {
    runId: string;
    alternativeId: string;
}): Promise<
    | { status: 'resumed'; sourceRunId: string; runId: string; decisionId: string; selectedAlternativeId: string }
    | { status: 'rejected'; reason: string }
> {
    const run = agentRunLifecycle.get(input.runId);
    const admission = getAgentRunDecisionResumeAdmission(run);
    if (run === null || admission.status === 'rejected') {
        return {
            status: 'rejected',
            reason:
                admission.status === 'rejected'
                    ? admission.reason
                    : 'The pending decision is unavailable or already consumed.',
        };
    }
    const decision = admission.decision;
    const selectedAlternative = decision.alternatives.find((alternative) => alternative.id === input.alternativeId);
    if (!selectedAlternative) {
        return { status: 'rejected', reason: 'The selected decision alternative is unavailable.' };
    }

    const attemptId = `decision-resume-${crypto.randomUUID()}`;
    try {
        agentRunLifecycle.claimDecisionResume({ runId: run.runId, attemptId });
    } catch (error) {
        return {
            status: 'rejected',
            reason: error instanceof Error ? error.message : 'The pending decision could not be reserved.',
        };
    }

    let resumedRunId: string | null = null;
    let resumedPlanAccepted = false;
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
                resumedRunId = newRunId;
            },
            onResumedPlanAccepted: () => {
                agentRunLifecycle.selectDecisionAlternative({
                    runId: run.runId,
                    alternativeId: selectedAlternative.id,
                    attemptId,
                });
                resumedPlanAccepted = true;
            },
        });
        if (resumedRunId === null || !resumedPlanAccepted) {
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
    } finally {
        if (!resumedPlanAccepted) {
            agentRunLifecycle.releaseDecisionResumeClaim({ runId: run.runId, attemptId });
        }
    }
}
