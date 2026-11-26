import { type AgentRunPlanBoundRefusal } from '../validators/readAgentRunPlanBoundRefusal';

/** The sentence every caller reports a refused write with. */
export function describeAgentRunPlanBoundRefusal(refusal: AgentRunPlanBoundRefusal): string {
    const subject = refusal.collection.startsWith('run.') ? 'the run' : "the run's plan";
    if (refusal.reason === 'receipt-bytes') {
        return `${subject} cannot keep an application tool receipt larger than ${String(refusal.bound)} bytes`;
    }
    if (refusal.reason === 'field-bytes') {
        return `${subject} cannot keep ${refusal.collection} larger than ${String(refusal.bound)} bytes`;
    }
    if (refusal.reason === 'field-length') {
        return `${subject} cannot keep ${refusal.collection} longer than ${String(refusal.bound)} characters`;
    }
    return `${subject} cannot hold more than ${String(refusal.bound)} entries in ${refusal.collection}`;
}
