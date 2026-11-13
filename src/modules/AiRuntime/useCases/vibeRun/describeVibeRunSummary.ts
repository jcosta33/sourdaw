import { type MetricGoalEvaluation } from '../../models/MetricGoalAdmission';
import { type ProjectContext } from '../../models/ProjectContext';
import { type ScheduledVibeRunBatch } from '../../models/VibeRunPlan';

import { describeVibeRunObjective } from './describeVibeRunObjective';
import { formatVibeFigure } from './formatVibeFigure';
import { readVibeMetricLabel } from './readVibeMetricLabel';
import { readVibeTargetName } from './readVibeTargetName';

type Criterion = MetricGoalEvaluation['criteria'][number];

/**
 * What became of one planned batch of a vibe run: applied with what its approved preview measured,
 * skipped at its card, refused before it was proposed, the batch the user stopped the run on, or
 * never proposed because the run ended before it.
 */
export type VibeBatchOutcome =
    | { readonly kind: 'applied'; readonly criteria: readonly Criterion[] }
    | { readonly kind: 'skipped' }
    | { readonly kind: 'refused'; readonly reason: string }
    | { readonly kind: 'stopped' }
    | { readonly kind: 'not-proposed' };

/** One planned batch position of a run, with what became of it. */
export type VibeRunBatchSummary = {
    readonly position: number;
    readonly batch: ScheduledVibeRunBatch;
    readonly outcome: VibeBatchOutcome;
};

function describeMeasuredDeltas(criteria: readonly Criterion[], context: Pick<ProjectContext, 'tracks'>): string {
    const deltas = criteria
        .filter((criterion) => criterion.source.kind === 'recipe')
        .map(
            (criterion) =>
                `${readVibeMetricLabel(criterion.metricId, criterion.band)} on ${criterion.targetIds.map((id) => readVibeTargetName(context, id)).join(', ')} approval preview, ${criterion.range?.sectionId ?? 'arrangement'} [${String(criterion.range?.startBeat)}, ${String(criterion.range?.endBeat)}], ${formatVibeFigure(criterion.baseline[0], criterion.unit)} → ${formatVibeFigure(criterion.observed[0], criterion.unit)}`
        );
    return deltas.length === 0 ? 'no measured change recorded' : deltas.join('; ');
}

function describeOutcome(outcome: VibeBatchOutcome, context: Pick<ProjectContext, 'tracks'>): string {
    switch (outcome.kind) {
        case 'applied':
            return describeMeasuredDeltas(outcome.criteria, context);
        case 'skipped':
            return 'skipped, not applied';
        case 'refused':
            return `refused: ${outcome.reason.replace(/\.$/u, '')}`;
        case 'stopped':
            return 'not applied, the run stopped here';
        case 'not-proposed':
            return 'not proposed';
        default: {
            const exhaustive: never = outcome;
            throw new Error(`Unsupported vibe batch outcome: ${JSON.stringify(exhaustive)}`);
        }
    }
}

function describeHeader(batches: readonly VibeRunBatchSummary[]): string {
    const applied = batches.filter((summary) => summary.outcome.kind === 'applied').length;
    const counted = `the brief and ${String(applied)} of ${String(batches.length)} batches were applied`;
    const stopped = batches.some((summary) => summary.outcome.kind === 'stopped' || summary.outcome.kind === 'refused');
    if (stopped) {
        return `The vibe run stopped: ${counted}.`;
    }
    if (batches.length > 0 && batches.every((summary) => summary.outcome.kind === 'skipped')) {
        return 'The vibe run finished: only the brief was applied; every batch was skipped.';
    }
    return `The vibe run finished: ${counted}.`;
}

/**
 * The one message a vibe run posts when it ends: a header saying whether it reached its end and how
 * many batches were applied, then one line per planned batch — every recipe criterion's measured
 * movement for an applied batch, and what happened instead for every other.
 */
export function describeVibeRunSummary(input: {
    batches: readonly VibeRunBatchSummary[];
    context: Pick<ProjectContext, 'tracks'>;
}): string {
    const lines = [describeHeader(input.batches)];
    for (const summary of input.batches) {
        lines.push(
            `- Batch ${String(summary.position)} (${describeVibeRunObjective(summary.batch)}): ${describeOutcome(summary.outcome, input.context)}.`
        );
    }
    return lines.join('\n');
}
