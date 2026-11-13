import { type ProjectContext } from '../../models/ProjectContext';
import { type MeasurementUnitProgress } from '../measureProjectUnit';
import { readVibeTargetName } from '../vibeRun/readVibeTargetName';

import { describeMeasurementRangeGroup } from './describeMeasurementRangeGroup';

/** The chat line while a vibe run measures its starting point, naming the target that renders. */
export function describeInitialMeasurementProgress(
    context: Pick<ProjectContext, 'tracks'>,
    progress: MeasurementUnitProgress
): string {
    return `Measuring the starting point: rendering ${readVibeTargetName(context, progress.targetId)}${describeMeasurementRangeGroup(progress)}...`;
}
