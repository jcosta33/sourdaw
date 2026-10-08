import { AGENT_RUN_ACTIVE_PHASES } from '../models/AgentRun';
import { readAgentRunState } from '../stores/agentRunStore';

import { agentRunCancellation } from './cancelAgentRun';

const PROJECT_BOUNDARY_CANCEL_REASON = 'The active project changed before the run finished.';

/**
 * Cancels every run still holding machine resources. The project boundary
 * (`resetModuleStoresToDefault`) calls this through its composition-root
 * registered seam (#4783): a project switch invalidates the revision every run
 * is bound to, and an executing run's render holds the process-wide render lock
 * until it ends, which would keep Export disabled in the incoming project.
 * `cancelAgentRun` never awaits — the abort controllers its work leases bound
 * fire before it returns — so the boundary's teardown stays synchronous and the
 * aborted renders unwind through the run's own cancellation machinery.
 */
export function cancelActiveAgentRuns(): void {
    const activeRuns = readAgentRunState().runs.filter((run) => AGENT_RUN_ACTIVE_PHASES.has(run.phase));
    for (const run of activeRuns) {
        // The promise rejects only when a run fails to reach a terminal phase;
        // the boundary must proceed either way, so the rejection is discarded
        // exactly like the abort-triggered re-cancel in `bindAgentRunAbortController`.
        void agentRunCancellation
            .cancel({ runId: run.runId, reason: PROJECT_BOUNDARY_CANCEL_REASON })
            .catch(() => undefined);
    }
}
