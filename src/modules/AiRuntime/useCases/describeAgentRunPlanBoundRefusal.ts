import { type AgentRunPlanBoundRefusal } from '../stores/readAgentRunPlanBoundRefusal';

/** The sentence every caller reports a refused plan write with. */
export function describeAgentRunPlanBoundRefusal(refusal: AgentRunPlanBoundRefusal): string {
    if (refusal.reason === 'receipt-bytes') {
        return `the run's plan cannot keep an application tool receipt larger than ${String(refusal.bound)} bytes`;
    }
    return `the run's plan cannot hold more than ${String(refusal.bound)} entries in ${refusal.collection}`;
}
