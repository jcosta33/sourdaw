import { type AgentRunSagaStep } from '../models/AgentRun';

import { agentRunLifecycle } from './agentRunLifecycle';

/** Read projection for recovery/UI: never hides committed or unresolved external work. */
export function getAgentRunSagaProjection(runId: string): AgentRunSagaStep[] {
    const run = agentRunLifecycle.get(runId);
    if (!run) {
        return [];
    }
    return run.saga.steps
        .filter((step) => ['committed', 'external-pending', 'uncompensated', 'manual-repair'].includes(step.state))
        .map((step) => structuredClone(step));
}
