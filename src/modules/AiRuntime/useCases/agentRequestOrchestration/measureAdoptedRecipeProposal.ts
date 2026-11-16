import { AGENT_RUN_TERMINAL_PHASES } from '../../models/AgentRun';
import { updateChatMessage } from '../../stores/chatStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { type compileAgentActionExecution } from '../compileAgentActionExecution';
import { compileAgentRiskApproval } from '../compileAgentRiskApproval';
import { type getProjectContext } from '../getProjectContext';
import { prepareMetricGoalPreview } from '../prepareMetricGoalPreview';

import { type readAdoptedRecipeMetricState } from './readAdoptedRecipeMetricState';
import { recordBatchPreviewEvidence } from './recordBatchPreviewEvidence';

type CompiledExecution = ReturnType<typeof compileAgentActionExecution>;

type AdoptedRecipeMeasurement =
    /** The preview could not run; the card is still shown and the metric admission blocks Confirm as missing. */
    | { status: 'unmeasured' }
    | { status: 'stopped' }
    | { status: 'measured'; metricGoalState: string; agentApproval: CompiledExecution['agentApproval'] };

/**
 * An adopted recipe proposal whose recipes promise something (the caller reads that synchronously,
 * so a proposal with nothing to measure never awaits) is measured before its card appears, as
 * a vibe-run batch is, so Confirm admits exactly what the preview showed. A preview that cannot run
 * leaves the card blocked by admission as missing, never admitted; a run stopped meanwhile persists
 * nothing.
 */
export async function measureAdoptedRecipeProposal(input: {
    runId: string;
    assistantMessageId: string;
    prompt: string;
    context: ReturnType<typeof getProjectContext>;
    revision: string;
    compiled: CompiledExecution;
    state: NonNullable<ReturnType<typeof readAdoptedRecipeMetricState>>;
}): Promise<AdoptedRecipeMeasurement> {
    const { runId, assistantMessageId, compiled, state } = input;
    function isStopped(): boolean {
        const run = agentRunLifecycle.get(runId);
        return run === null || AGENT_RUN_TERMINAL_PHASES.has(run.phase) || run.cancellation.requestedAt !== null;
    }
    updateChatMessage(assistantMessageId, {
        stoppableRunId: runId,
        content: 'Measuring what the recipe promises before proposing it...',
    });
    let proof: Awaited<ReturnType<typeof prepareMetricGoalPreview>>;
    try {
        proof = await prepareMetricGoalPreview({
            state,
            commandBatch: compiled.commandBatch,
            context: input.context,
            prompt: input.prompt,
            runId,
        });
    } catch {
        updateChatMessage(assistantMessageId, { stoppableRunId: undefined });
        return isStopped() ? { status: 'stopped' } : { status: 'unmeasured' };
    }
    updateChatMessage(assistantMessageId, { stoppableRunId: undefined });
    const liveRun = agentRunLifecycle.get(runId);
    if (liveRun === null || isStopped()) {
        return { status: 'stopped' };
    }
    const agentApproval = compileAgentRiskApproval({
        commandBatch: compiled.commandBatch,
        requireExplicitApproval: true,
        metricGoalState: JSON.stringify(proof.state),
    });
    recordBatchPreviewEvidence(liveRun, input.revision, agentApproval.metricGoalState ?? undefined, proof.receipts);
    return { status: 'measured', metricGoalState: JSON.stringify(proof.state), agentApproval };
}
