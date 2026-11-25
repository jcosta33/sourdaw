import { type AgentRun } from '../models/AgentRun';
import { readAgentRunBoundRefusal } from '../validators/readAgentRunBoundRefusal';

import { describeAgentRunPlanBoundRefusal } from './describeAgentRunPlanBoundRefusal';

/** The write path itself refuses a run its admission would refuse, before anything is persisted. */
export function requireAdmittedAgentRun(run: AgentRun): AgentRun {
    const refusal = readAgentRunBoundRefusal(run);
    if (refusal !== null) {
        throw new Error(describeAgentRunPlanBoundRefusal(refusal));
    }
    return run;
}
