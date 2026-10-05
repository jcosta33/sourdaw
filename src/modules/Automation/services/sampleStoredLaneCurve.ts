import { evaluateAutomationCurve } from '#/utils/automationCurve';

import { type AutomationPoint } from '../models/Automation';

/**
 * What a lane's points draw at `beat`, before any lane bound or link scale: the stored curve an
 * edit reshapes. A lane holding no points draws nothing of its own, so the parameter's own value
 * stands in for it. Segment selection and curve math are the playback evaluator's: the last point
 * at or before the beat opens the segment, and a beat before the first point holds that point.
 */
export function sampleStoredLaneCurve(points: readonly AutomationPoint[], baseValue: number, beat: number): number {
    const [first] = points;
    if (first === undefined) {
        return baseValue;
    }
    const segmentIndex = points.findLastIndex((point) => point.beat <= beat);
    const segmentStart = points[segmentIndex];
    const segmentEnd = points[segmentIndex + 1];
    if (segmentStart === undefined) {
        return first.value;
    }
    if (segmentEnd === undefined) {
        return segmentStart.value;
    }
    return evaluateAutomationCurve({
        firstPoint: segmentStart,
        secondPoint: segmentEnd,
        beat,
        previousPoint: points[segmentIndex - 1],
        nextPoint: points[segmentIndex + 2],
    });
}
