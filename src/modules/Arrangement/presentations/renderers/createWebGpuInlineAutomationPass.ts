import { resolveToken } from '#/utils/UI/resolveToken';

import {
    type AutomationSubLaneRenderModel,
    type TimelineRenderModel,
    type TrackRenderModel,
} from '../../models/TimelineRenderModel';
import { AUTOMATION_SUB_LANE_HEIGHT, getAutomationSubLaneTop } from '../../models/TimelineTrackExtent';

import { forEachInlineAutomationSegment, inlineAutomationColor } from './inlineAutomationEnvelope';

type Rgba = [number, number, number, number];
type AutomationQuad = {
    left: number;
    top: number;
    right: number;
    bottom: number;
    rightEdgeYOffset?: number;
};
type InlineAutomationDrawing = {
    addRect: (rect: AutomationQuad, color: string | Rgba, alpha?: number) => void;
    colorToRgba: (color: string, alpha?: number) => Rgba;
};

export function createWebGpuInlineAutomationPass(
    model: TimelineRenderModel,
    { width, height, dpr }: { width: number; height: number; dpr: number },
    { addRect, colorToRgba }: InlineAutomationDrawing
) {
    const rows: { lane: AutomationSubLaneRenderModel; top: number }[] = [];

    function collectTrackRows(track: TrackRenderModel, trackTop: number): void {
        const variationCount = track.variationLanes?.length ?? 0;
        for (const [laneIndex, lane] of (track.automationLanes ?? []).entries()) {
            const top = trackTop + getAutomationSubLaneTop(track.height, variationCount, laneIndex) * dpr;
            const bottom = top + AUTOMATION_SUB_LANE_HEIGHT * dpr;
            if (bottom <= 0 || top >= height) {
                continue;
            }
            rows.push({ lane, top });
        }
    }

    function drawBackings(availableQuads: number): number {
        const backingQuadsPerRow = 2;
        const maxSegments = rows.length > 0 ? Math.floor(availableQuads / rows.length) - backingQuadsPerRow : 0;
        if (maxSegments <= 0) {
            return 0;
        }
        const backing = resolveToken('--color-bg-well', '#0e0c0b');
        for (const { top } of rows) {
            addRect({ left: 0, top, right: width, bottom: top + AUTOMATION_SUB_LANE_HEIGHT * dpr }, backing);
            addRect({ left: 0, top, right: width, bottom: top + dpr }, '#ffffff', 0.08);
        }
        return maxSegments;
    }

    function drawEnvelopes(maxSegments: number): void {
        if (maxSegments <= 0) {
            return;
        }
        for (const { lane, top } of rows) {
            const color = colorToRgba(inlineAutomationColor(lane), 1);
            forEachInlineAutomationSegment(lane, model, { width: width / dpr, maxSegments }, (from, to) => {
                const y = top + from.y * dpr;
                addRect(
                    {
                        left: from.x * dpr,
                        top: y - dpr,
                        right: to.x * dpr,
                        bottom: y + dpr,
                        rightEdgeYOffset: (to.y - from.y) * dpr,
                    },
                    color
                );
            });
        }
    }

    return { collectTrackRows, drawBackings, drawEnvelopes };
}
