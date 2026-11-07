import { type MetricGoalEvaluation } from '../../models/MetricGoalAdmission';
import { type ProjectContext } from '../../models/ProjectContext';
import { type ScheduledVibeRunBatch } from '../../models/VibeRunPlan';

import { describeVibeRunObjective } from './describeVibeRunObjective';
import { formatVibeFigure } from './formatVibeFigure';
import { readVibeMetricLabel } from './readVibeMetricLabel';
import { readVibeTargetName } from './readVibeTargetName';

type Criterion = MetricGoalEvaluation['criteria'][number];

/** One committed batch of a finished run, as its approved preview measured it. */
export type CommittedVibeBatch = {
    readonly position: number;
    readonly batch: ScheduledVibeRunBatch;
    readonly criteria: readonly Criterion[];
};

/**
 * The one message a finished vibe run posts: for each batch it committed, the objective and every
 * recipe criterion's measured movement, so the run ends saying what each approved batch changed.
 */
export function describeVibeRunSummary(input: {
    total: number;
    batches: readonly CommittedVibeBatch[];
    context: Pick<ProjectContext, 'tracks'>;
}): string {
    const lines = [
        `The vibe run finished: the brief and ${String(input.batches.length)} of ${String(input.total - 1)} batches were applied.`,
    ];
    for (const committed of input.batches) {
        const deltas = committed.criteria
            .filter((criterion) => criterion.source.kind === 'recipe')
            .map(
                (criterion) =>
                    `${readVibeMetricLabel(criterion.metricId, criterion.band)} on ${criterion.targetIds.map((id) => readVibeTargetName(input.context, id)).join(', ')} approval preview, ${criterion.range?.sectionId ?? 'arrangement'} [${String(criterion.range?.startBeat)}, ${String(criterion.range?.endBeat)}], ${formatVibeFigure(criterion.baseline[0], criterion.unit)} → ${formatVibeFigure(criterion.observed[0], criterion.unit)}`
            );
        const measured = deltas.length === 0 ? 'no measured change recorded' : deltas.join('; ');
        lines.push(
            `- Batch ${String(committed.position)} (${describeVibeRunObjective(committed.batch)}): ${measured}.`
        );
    }
    return lines.join('\n');
}
