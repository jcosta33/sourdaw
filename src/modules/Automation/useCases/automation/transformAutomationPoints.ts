import { type AutomationLane, type AutomationPoint } from '../../models/Automation';
import { simplifyAutomationPoints } from '../../services/automationPointAlgorithms';

type AutomationPointTransform =
    | { type: 'scale'; factor: number; anchor?: number }
    | { type: 'stretch'; factor: number; anchorBeat?: number }
    | { type: 'invert' }
    | { type: 'reverse' }
    | { type: 'thin'; tolerance?: number }
    | { type: 'quantize'; gridSize: number };

function clonePoint(point: AutomationPoint): AutomationPoint {
    const clone = { ...point };
    if (point.cp1) {
        clone.cp1 = { ...point.cp1 };
    }
    if (point.cp2) {
        clone.cp2 = { ...point.cp2 };
    }
    return clone;
}

function stretchPoints(lane: AutomationLane, factor: number, anchorBeat?: number): AutomationPoint[] {
    let anchor = anchorBeat;
    if (anchor === undefined) {
        let minBeat = Infinity;
        for (const point of lane.points) {
            if (point.beat < minBeat) {
                minBeat = point.beat;
            }
        }
        anchor = minBeat === Infinity ? 0 : minBeat;
    }
    return lane.points
        .map((point) => ({
            ...clonePoint(point),
            beat: Math.max(0, anchor + (point.beat - anchor) * factor),
        }))
        .sort((alpha, beta) => alpha.beat - beta.beat);
}

function reversePoints(lane: AutomationLane): AutomationPoint[] {
    if (lane.points.length === 0) {
        return [];
    }
    let minBeat = Infinity;
    let maxBeat = -Infinity;
    for (const point of lane.points) {
        if (point.beat < minBeat) {
            minBeat = point.beat;
        }
        if (point.beat > maxBeat) {
            maxBeat = point.beat;
        }
    }
    return lane.points
        .map((point) => ({ ...clonePoint(point), beat: minBeat + maxBeat - point.beat }))
        .sort((alpha, beta) => alpha.beat - beta.beat);
}

export function transformAutomationPoints(
    lane: AutomationLane,
    transform: AutomationPointTransform
): AutomationPoint[] {
    if (transform.type === 'scale') {
        const anchor = transform.anchor ?? 0;
        return lane.points.map((point) => ({
            ...clonePoint(point),
            value: Math.min(lane.maxValue, Math.max(lane.minValue, anchor + (point.value - anchor) * transform.factor)),
        }));
    }
    if (transform.type === 'stretch') {
        return stretchPoints(lane, transform.factor, transform.anchorBeat);
    }
    if (transform.type === 'invert') {
        return lane.points.map((point) => ({
            ...clonePoint(point),
            value: lane.maxValue - (point.value - lane.minValue),
        }));
    }
    if (transform.type === 'reverse') {
        return reversePoints(lane);
    }
    if (transform.type === 'thin') {
        if (lane.points.length <= 2) {
            return lane.points.map(clonePoint);
        }
        return simplifyAutomationPoints({ points: lane.points, tolerance: transform.tolerance ?? 0.01 }).map(
            clonePoint
        );
    }
    if (!(transform.gridSize > 0) || !Number.isFinite(transform.gridSize)) {
        return lane.points.map(clonePoint);
    }
    const snapped = new Map<number, AutomationPoint>();
    for (const point of lane.points) {
        const beat = Math.round(point.beat / transform.gridSize) * transform.gridSize;
        snapped.set(beat, { ...clonePoint(point), beat });
    }
    return Array.from(snapped.values()).sort((alpha, beta) => alpha.beat - beta.beat);
}
