import { type MeasurementUnitProgress } from '../measureProjectUnit';

/** Which of a target's range groups renders, named only when the target renders in more than one. */
export function describeMeasurementRangeGroup(
    progress: Pick<MeasurementUnitProgress, 'groupIndex' | 'groupCount'>
): string {
    return progress.groupCount > 1
        ? `, ranges ${String(progress.groupIndex + 1)} of ${String(progress.groupCount)}`
        : '';
}
