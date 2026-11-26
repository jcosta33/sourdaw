import { type AgentRunState } from '../models/AgentRun';
import { readAgentRunBoundRefusal } from '../validators/readAgentRunBoundRefusal';

type Recovery = { state: AgentRunState; recoveredRunIds: string[] };

/** A recovered run the restore bounds refuse keeps its stored form; every other recovery stands. */
export function admitRecoveredAgentRuns(stored: AgentRunState, recovery: Recovery): Recovery {
    const storedById = new Map(stored.runs.map((run) => [run.runId, run]));
    const refusedRunIds = new Set<string>();
    const runs = recovery.state.runs.map((run) => {
        const original = storedById.get(run.runId);
        if (original === undefined || !recovery.recoveredRunIds.includes(run.runId)) {
            return run;
        }
        if (readAgentRunBoundRefusal(run) === null) {
            return run;
        }
        refusedRunIds.add(run.runId);
        return original;
    });
    return {
        state: { ...recovery.state, runs },
        recoveredRunIds: recovery.recoveredRunIds.filter((runId) => !refusedRunIds.has(runId)),
    };
}
