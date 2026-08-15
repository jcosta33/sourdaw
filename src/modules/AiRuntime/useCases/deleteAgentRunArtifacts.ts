import { readAgentRunState, persistAgentRunState } from '../stores/agentRunStore';

export function deleteAgentRunArtifacts(runId: string): void {
    const state = readAgentRunState();
    persistAgentRunState({ ...state, runs: state.runs.filter((run) => run.runId !== runId) });
}
