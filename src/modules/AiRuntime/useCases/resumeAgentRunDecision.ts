import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { agentRunLifecycle } from './agentRunLifecycle';
import { sendChatMessage } from './sendChatMessage';

export async function resumeAgentRunDecision(input: {
    runId: string;
    alternativeId: string;
}): Promise<{ status: 'resumed'; selectedAlternativeId: string } | { status: 'rejected'; reason: string }> {
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
    if (captureProjectRevision() !== run.decision.revision) {
        return { status: 'rejected', reason: 'The project revision changed while the decision was pending.' };
    }
    if (
        JSON.stringify(run.scope) !== JSON.stringify(run.decision.scope) ||
        JSON.stringify(run.grants) !== JSON.stringify(run.decision.grants)
    ) {
        return { status: 'rejected', reason: 'The persisted decision authority no longer matches this run.' };
    }
    if (!run.decision.alternatives.some((alternative) => alternative.id === input.alternativeId)) {
        return { status: 'rejected', reason: 'The selected decision alternative is unavailable.' };
    }
    try {
        agentRunLifecycle.selectDecisionAlternative(input);
        await sendChatMessage(run.request, { mode: run.mode, budgets: run.budgets });
        return { status: 'resumed', selectedAlternativeId: input.alternativeId };
    } catch (error) {
        return {
            status: 'rejected',
            reason: error instanceof Error ? error.message : 'The pending decision could not resume.',
        };
    }
}
