import { type ReactElement, useState } from 'react';

import { useStore } from '#/infra/store/useStore';

import { type AgentRunState } from '../../models/AgentRun';
import { agentRunStore } from '../../stores/agentRunStore';
import { agentRunControls } from '../../useCases/getAgentRunControlProjection';
import { AgentRunDecisionControls } from '../components/AgentRunDecisionControls';

/** Stable identity: `useSyncExternalStore` re-renders forever on a fresh default per read. */
const EMPTY_AGENT_RUN_STATE: AgentRunState = { schemaVersion: 1, runs: [] };

/**
 * Pending agent decisions, mountable on any surface that shows agent runs.
 * `ChatPanel` renders the same controls with the same resume semantics; a
 * decision answered on either surface leaves the other with nothing to show.
 */
export const AgentRunDecisionPanel = (): ReactElement | null => {
    // `listDecisions` reads the run store through the module, not through a
    // value the compiler can see change, so memoizing this component would
    // freeze the decision list at its first render.
    'use no memo';

    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const agentRunState = useStore(agentRunStore, EMPTY_AGENT_RUN_STATE);
    const decisions = agentRunState.schemaVersion === 1 ? agentRunControls.listDecisions() : [];

    const handleResumeDecision = async (runId: string, alternativeId: string): Promise<void> => {
        const decisionRun = decisions.find((run) => run.runId === runId);
        if (decisionRun === undefined || !decisionRun.allowedActions.resume) {
            setStatusMessage(
                decisionRun?.resumeRejectionReason ?? 'The pending decision is unavailable or already consumed.'
            );
            return;
        }
        const alternative = decisionRun.decision.alternatives.find((candidate) => candidate.id === alternativeId);
        if (alternative === undefined) {
            setStatusMessage('The selected decision alternative is unavailable.');
            return;
        }

        setStatusMessage(`Resuming with ${alternative.label}.`);
        const result = await agentRunControls.resumeDecision({ runId, alternativeId });
        if (result.status === 'resumed') {
            setStatusMessage(`Started replacement agent run ${result.runId}.`);
            return;
        }
        setStatusMessage(result.reason);
    };

    return (
        <AgentRunDecisionControls
            decisions={decisions}
            statusMessage={statusMessage}
            onResumeDecision={(runId, alternativeId) => {
                void handleResumeDecision(runId, alternativeId);
            }}
        />
    );
};
