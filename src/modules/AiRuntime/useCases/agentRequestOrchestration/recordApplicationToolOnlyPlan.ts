import {
    readApplicationToolOnlyEvidence,
    type ApplicationToolOnlyPlanInput,
} from '../../transformers/readApplicationToolOnlyEvidence';
import { agentRunLifecycle } from '../agentRunLifecycle';

/** Its write refuses, as a planning failure, receipts the run's plan could not persist. */
export function recordApplicationToolOnlyPlan(input: ApplicationToolOnlyPlanInput): void {
    if (input.receipts.length === 0) {
        return;
    }
    agentRunLifecycle.recordApplicationToolEvidence(readApplicationToolOnlyEvidence(input));
}
