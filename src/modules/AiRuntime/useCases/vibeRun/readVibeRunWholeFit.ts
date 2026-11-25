import { type ApplicationToolReceipt } from '../../models/ApplicationOwnedTool';
import { type PerceptualConstraintReading } from '../../models/PerceptualConstraint';
import { type ProjectContext } from '../../models/ProjectContext';
import { type ScheduledVibeRunBatch } from '../../models/VibeRunPlan';
import { readAgentResourceLimits } from '../../stores/agentResourceLimitsStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { type planMetricMeasurementRequests } from '../planMetricMeasurementRequests';

import { readVibeRunFitRefusals } from './readVibeRunFitRefusals';

/** Why the whole run does not fit the run it spends from, or an empty list when it does. */
export function readVibeRunWholeFit(
    input: { runId: string; context: ProjectContext; priorReceipts: readonly ApplicationToolReceipt[] },
    batches: readonly ScheduledVibeRunBatch[],
    reading: PerceptualConstraintReading,
    initialReads: Parameters<typeof planMetricMeasurementRequests>[0]['reads']
): string[] {
    const run = agentRunLifecycle.get(input.runId);
    if (run === null) {
        return ['this run no longer exists'];
    }
    const refusals = readVibeRunFitRefusals({
        batches,
        context: input.context,
        reading,
        budgets: run.budgets,
        initialReads,
        priorReceipts: input.priorReceipts.length,
    });
    if (run.activeSince !== null && Date.now() - run.activeSince > readAgentResourceLimits().runDurationMs) {
        refusals.push('runDurationMs: this run has no active time left');
    }
    return refusals;
}
