import { type ApplicationToolReceipt } from '../../models/ApplicationOwnedTool';
import { type IntentResult } from '../../models/IntentResult';
import { type MeasurementAdmitter } from '../../models/MeasurementBudget';
import { type ProjectContext, type ProjectContextProductionBrief } from '../../models/ProjectContext';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { type MeasurementUnitProgress } from '../measureProjectUnit';
import { type CatalogBriefMixIntent } from '../readBriefMixIntent';

import { planVibeRunSchedule } from './planVibeRunSchedule';

export type PlannedBriefVibeRun = Pick<
    IntentResult,
    'batchSchedule' | 'plannedRunLines' | 'applicationToolReceipts' | 'initialBaselineRefusal'
>;

/**
 * The vibe run a brief carries: planned from the brief the user is about to confirm, with no provider
 * call, and scheduled behind it only when it fits the run. A request that plans no batch adds nothing,
 * so its brief result is exactly what it was before runs were planned.
 */
export async function planBriefVibeRun(input: {
    prompt: string;
    context: ProjectContext;
    brief: ProjectContextProductionBrief;
    mixIntent: CatalogBriefMixIntent;
    runId: string | undefined;
    sourceRevision: string | undefined;
    signal: AbortSignal | undefined;
    admit: MeasurementAdmitter | undefined;
    priorReceipts: readonly ApplicationToolReceipt[];
    onProgress: ((progress: MeasurementUnitProgress) => void) | undefined;
    /** The plan a chosen reading retained; a live preparation that differs plans nothing. */
    expectedPlanDigest?: string;
}): Promise<PlannedBriefVibeRun> {
    if (
        input.runId === undefined ||
        input.sourceRevision === undefined ||
        input.signal === undefined ||
        input.admit === undefined
    ) {
        return {
            plannedRunLines: [
                'No batches were scheduled after the brief: initial measurements require a live run, original revision, cancellation signal and budget admission.',
            ],
        };
    }
    const run = agentRunLifecycle.get(input.runId);
    if (run === null) {
        return {};
    }
    const planned = await planVibeRunSchedule({
        prompt: input.prompt,
        context: input.context,
        brief: input.brief,
        mixIntent: input.mixIntent,
        budgets: run.budgets,
        runId: input.runId,
        sourceRevision: input.sourceRevision,
        signal: input.signal,
        admit: input.admit,
        priorReceipts: input.priorReceipts,
        onProgress: input.onProgress,
        expectedPlanDigest: input.expectedPlanDigest,
    });
    if (planned.status === 'none') {
        return {};
    }
    if (planned.status === 'unscheduled') {
        const collected = planned.receipts ?? [];
        return {
            plannedRunLines: planned.lines,
            applicationToolReceipts: [...input.priorReceipts, ...collected],
            initialBaselineRefusal: planned.refusal,
        };
    }
    return {
        batchSchedule: planned.schedule,
        plannedRunLines: planned.lines,
        applicationToolReceipts: [...input.priorReceipts, ...planned.receipts],
    };
}
