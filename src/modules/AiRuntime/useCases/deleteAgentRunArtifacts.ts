import { readAgentRunState, persistAgentRunState } from '../stores/agentRunStore';

export function deleteAgentRunArtifacts(runId: string): void {
    const state = readAgentRunState();
    persistAgentRunState({
        ...state,
        runs: state.runs.map((run) =>
            run.runId === runId ? { ...run, renders: [], analyses: [], temporaryAssets: [] } : run
        ),
    });
}
