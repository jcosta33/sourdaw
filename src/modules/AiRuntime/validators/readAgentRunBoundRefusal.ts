import { type AgentRun } from '../models/AgentRun';

import { readAgentRunFieldBoundRefusal } from './readAgentRunFieldBoundRefusal';
import { readAgentRunNestedBoundRefusal } from './readAgentRunNestedBoundRefusal';
import { type AgentRunPlanBoundRefusal, readAgentRunPlanBoundRefusal } from './readAgentRunPlanBoundRefusal';

/** Whether the run a write would leave can be persisted and read back under its schema bounds; `null` admits it. */
export function readAgentRunBoundRefusal(run: AgentRun): AgentRunPlanBoundRefusal | null {
    const planRefusal = run.plan === null ? null : readAgentRunPlanBoundRefusal(run.plan);
    return planRefusal ?? readAgentRunFieldBoundRefusal(run) ?? readAgentRunNestedBoundRefusal(run);
}
