import { type AutomationPoint } from '../models/Automation';

/** Keep the upper-bound slot so equal-beat step points retain their order. */
export function insertAutomationPointAtBeat(
    points: readonly AutomationPoint[],
    point: AutomationPoint
): AutomationPoint[] {
    let lo = 0;
    let hi = points.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (points[mid]!.beat <= point.beat) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    const next = [...points];
    next.splice(lo, 0, point);
    return next;
}
