import { type ProjectContext } from '../../models/ProjectContext';
import { type MeasurementUnitProgress } from '../measureProjectUnit';
import { type MetricGoalPreviewProgress } from '../prepareMetricGoalPreview';
import { readVibeTargetName } from '../vibeRun/readVibeTargetName';

type Tracks = Pick<ProjectContext, 'tracks'>;

function describeRangeGroup(progress: Pick<MeasurementUnitProgress, 'groupIndex' | 'groupCount'>): string {
    return progress.groupCount > 1
        ? `, ranges ${String(progress.groupIndex + 1)} of ${String(progress.groupCount)}`
        : '';
}

function describeDocument(progress: MetricGoalPreviewProgress): string {
    if (progress.document === 'project') {
        return 'as it is now';
    }
    if (progress.step === null || progress.step === progress.steps) {
        return 'with the whole batch applied';
    }
    return progress.step === 1
        ? 'with step 1 of the batch applied'
        : `with steps 1–${String(progress.step)} of the batch applied`;
}

/** The chat line while a vibe run measures its starting point, naming the target that renders. */
export function describeInitialMeasurementProgress(context: Tracks, progress: MeasurementUnitProgress): string {
    return `Measuring the starting point: rendering ${readVibeTargetName(context, progress.targetId)}${describeRangeGroup(progress)}...`;
}

/** The chat line while a batch preview renders, naming the target and which document of the batch renders. */
export function describeBatchPreviewProgress(input: {
    context: Tracks;
    position: number;
    total: number;
    progress: MetricGoalPreviewProgress;
}): string {
    const { context, position, total, progress } = input;
    return `Preparing batch ${String(position)} of ${String(total)}: rendering ${readVibeTargetName(context, progress.targetId)} ${describeDocument(progress)}${describeRangeGroup(progress)}...`;
}
