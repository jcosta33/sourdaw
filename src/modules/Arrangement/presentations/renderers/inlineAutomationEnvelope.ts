import { resolveToken } from '#/utils/UI/resolveToken';

import { automationSubLaneYAtValue } from '../../models/AutomationSubLaneGeometry';
import { type AutomationSubLaneRenderModel, type TimelineRenderModel } from '../../models/TimelineRenderModel';

export function inlineAutomationColor(lane: AutomationSubLaneRenderModel): string {
    return lane.color ?? resolveToken('--color-accent-lavender', '#a995ea');
}

type EnvelopePoint = { x: number; y: number };

export function forEachInlineAutomationSegment(
    lane: AutomationSubLaneRenderModel,
    { viewportStartBeat, pixelsPerBeat }: Pick<TimelineRenderModel, 'viewportStartBeat' | 'pixelsPerBeat'>,
    width: number,
    drawSegment: (from: EnvelopePoint, to: EnvelopePoint) => void,
    maxSegments = Infinity
): void {
    // Subdivide in screen space so curves remain legible without rendering offscreen points.
    const segments = Math.min(Math.ceil(width / 4), maxSegments);
    if (segments <= 0) {
        return;
    }
    let previous: EnvelopePoint | null = null;
    for (let index = 0; index <= segments; index++) {
        const x = (width * index) / segments;
        const value = lane.valueAtBeat(viewportStartBeat + x / pixelsPerBeat);
        if (value === null) {
            return;
        }
        const point = { x, y: automationSubLaneYAtValue(lane, value) };
        if (previous) {
            drawSegment(previous, point);
        }
        previous = point;
    }
}
