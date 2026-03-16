import { automationStore } from "../stores/automationStore";
import { createAutomationLane, type AutomationPoint } from "../models/Automation";

export const addAutomationLane = (
    trackId: string,
    parameterId: string,
    parameterName: string,
): void => {
    const state = automationStore.value;
    if (!state) return;

    const exists = state.lanes.some(
        (l) => l.trackId === trackId && l.parameterId === parameterId,
    );
    if (exists) return;

    automationStore.set({
        lanes: [...state.lanes, createAutomationLane(trackId, parameterId, parameterName)],
    });
};

export const removeAutomationLane = (laneId: string): void => {
    const state = automationStore.value;
    if (!state) return;
    automationStore.set({
        lanes: state.lanes.filter((l) => l.id !== laneId),
    });
};

export const toggleAutomationVisibility = (laneId: string): void => {
    const state = automationStore.value;
    if (!state) return;
    automationStore.set({
        lanes: state.lanes.map((l) =>
            l.id === laneId ? { ...l, visible: !l.visible } : l,
        ),
    });
};

export const addAutomationPoint = (
    laneId: string,
    point: AutomationPoint,
): void => {
    const state = automationStore.value;
    if (!state) return;
    automationStore.set({
        lanes: state.lanes.map((l) =>
            l.id === laneId
                ? {
                    ...l,
                    points: [...l.points, point].sort((a, b) => a.beat - b.beat),
                }
                : l,
        ),
    });
};

export const removeAutomationPoint = (laneId: string, beat: number): void => {
    const state = automationStore.value;
    if (!state) return;
    automationStore.set({
        lanes: state.lanes.map((l) =>
            l.id === laneId
                ? { ...l, points: l.points.filter((p) => p.beat !== beat) }
                : l,
        ),
    });
};

export const updateAutomationPoint = (
    laneId: string,
    beat: number,
    newValue: number,
    newBeat?: number,
): void => {
    const state = automationStore.value;
    if (!state) return;
    automationStore.set({
        lanes: state.lanes.map((l) => {
            if (l.id !== laneId) return l;
            const updated = l.points.map((p) =>
                p.beat === beat
                    ? { ...p, value: newValue, beat: newBeat ?? p.beat }
                    : p,
            );
            return { ...l, points: updated.sort((a, b) => a.beat - b.beat) };
        }),
    });
};

export const batchAddAutomationPoints = (
    laneId: string,
    points: AutomationPoint[],
): void => {
    const state = automationStore.value;
    if (!state) return;
    automationStore.set({
        lanes: state.lanes.map((l) => {
            if (l.id !== laneId) return l;
            const merged = [...l.points];
            for (const pt of points) {
                const existingIdx = merged.findIndex((p) => Math.abs(p.beat - pt.beat) < 0.05);
                if (existingIdx >= 0) {
                    merged[existingIdx] = pt;
                } else {
                    merged.push(pt);
                }
            }
            return { ...l, points: merged.sort((a, b) => a.beat - b.beat) };
        }),
    });
};

export const addClipAutomationLane = (
    trackId: string,
    clipId: string,
    parameterId: string,
    parameterName: string,
): void => {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const exists = state.lanes.some(
        (l) => l.clipId === clipId && l.parameterId === parameterId,
    );
    if (exists) {
        return;
    }

    automationStore.set({
        lanes: [
            ...state.lanes,
            createAutomationLane(trackId, parameterId, parameterName, 0, 1, clipId),
        ],
    });
};

export const shiftClipAutomation = (clipId: string, beatDelta: number): void => {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    automationStore.set({
        lanes: state.lanes.map((lane) => {
            if (lane.clipId !== clipId) {
                return lane;
            }
            return {
                ...lane,
                points: lane.points.map((p) => ({
                    ...p,
                    beat: p.beat + beatDelta,
                })),
            };
        }),
    });
};

export const duplicateClipAutomation = (sourceClipId: string, newClipId: string): void => {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const sourceLanes = state.lanes.filter((l) => l.clipId === sourceClipId);
    if (sourceLanes.length === 0) {
        return;
    }

    const newLanes = sourceLanes.map((lane) =>
        createAutomationLane(
            lane.trackId,
            lane.parameterId,
            lane.parameterName,
            lane.minValue,
            lane.maxValue,
            newClipId,
        ),
    ).map((newLane, i) => ({
        ...newLane,
        points: sourceLanes[i]!.points.map((p) => ({ ...p })),
        visible: sourceLanes[i]!.visible,
    }));

    automationStore.set({
        lanes: [...state.lanes, ...newLanes],
    });
};

export const scaleAutomationValues = (
    laneId: string,
    factor: number,
    anchor = 0,
): void => {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((lane) => {
            if (lane.id !== laneId) {
                return lane;
            }
            return {
                ...lane,
                points: lane.points.map((p) => ({
                    ...p,
                    value: Math.min(
                        lane.maxValue,
                        Math.max(lane.minValue, anchor + (p.value - anchor) * factor),
                    ),
                })),
            };
        }),
    });
};

export const stretchAutomationTime = (
    laneId: string,
    factor: number,
    anchorBeat = 0,
): void => {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((lane) => {
            if (lane.id !== laneId) {
                return lane;
            }
            return {
                ...lane,
                points: lane.points
                    .map((p) => ({
                        ...p,
                        beat: Math.max(0, anchorBeat + (p.beat - anchorBeat) * factor),
                    }))
                    .sort((a, b) => a.beat - b.beat),
            };
        }),
    });
};

export const invertAutomation = (laneId: string): void => {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((lane) => {
            if (lane.id !== laneId) {
                return lane;
            }
            return {
                ...lane,
                points: lane.points.map((p) => ({
                    ...p,
                    value: lane.maxValue - (p.value - lane.minValue),
                })),
            };
        }),
    });
};

export const reverseAutomation = (laneId: string): void => {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((lane) => {
            if (lane.id !== laneId) {
                return lane;
            }
            if (lane.points.length === 0) {
                return lane;
            }
            const maxBeat = Math.max(...lane.points.map((p) => p.beat));
            return {
                ...lane,
                points: lane.points
                    .map((p) => ({ ...p, beat: maxBeat - p.beat }))
                    .sort((a, b) => a.beat - b.beat),
            };
        }),
    });
};

const perpendicularDistance = (
    point: { beat: number; value: number },
    lineStart: { beat: number; value: number },
    lineEnd: { beat: number; value: number },
): number => {
    const dx = lineEnd.beat - lineStart.beat;
    const dy = lineEnd.value - lineStart.value;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq === 0) {
        const dbx = point.beat - lineStart.beat;
        const dby = point.value - lineStart.value;
        return Math.sqrt(dbx * dbx + dby * dby);
    }
    const num = Math.abs(
        dy * point.beat - dx * point.value + lineEnd.beat * lineStart.value - lineEnd.value * lineStart.beat,
    );
    return num / Math.sqrt(lengthSq);
};

const rdpSimplify = (
    points: AutomationPoint[],
    tolerance: number,
): AutomationPoint[] => {
    if (points.length <= 2) {
        return points;
    }

    let maxDist = 0;
    let maxIdx = 0;
    const first = points[0]!;
    const last = points[points.length - 1]!;

    for (let i = 1; i < points.length - 1; i++) {
        const dist = perpendicularDistance(points[i]!, first, last);
        if (dist > maxDist) {
            maxDist = dist;
            maxIdx = i;
        }
    }

    if (maxDist > tolerance) {
        const left = rdpSimplify(points.slice(0, maxIdx + 1), tolerance);
        const right = rdpSimplify(points.slice(maxIdx), tolerance);
        return [...left.slice(0, -1), ...right];
    }

    return [first, last];
};

export const thinAutomationPoints = (
    laneId: string,
    tolerance = 0.01,
): void => {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((lane) => {
            if (lane.id !== laneId) {
                return lane;
            }
            if (lane.points.length <= 2) {
                return lane;
            }
            return { ...lane, points: rdpSimplify(lane.points, tolerance) };
        }),
    });
};

export const quantizeAutomationBeats = (
    laneId: string,
    gridSize: number,
): void => {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((lane) => {
            if (lane.id !== laneId) {
                return lane;
            }
            const snapped = new Map<number, AutomationPoint>();
            for (const p of lane.points) {
                const quantized = Math.round(p.beat / gridSize) * gridSize;
                snapped.set(quantized, { ...p, beat: quantized });
            }
            return {
                ...lane,
                points: Array.from(snapped.values()).sort((a, b) => a.beat - b.beat),
            };
        }),
    });
};

export const getAutomationValueAtBeat = (laneId: string, beat: number): number | null => {
    const state = automationStore.value;
    if (!state) return null;

    const lane = state.lanes.find((l) => l.id === laneId);
    if (!lane || lane.points.length === 0) return null;

    const before = lane.points.filter((p) => p.beat <= beat);
    const after = lane.points.filter((p) => p.beat > beat);

    if (before.length === 0) return lane.points[0]!.value;
    if (after.length === 0) return before[before.length - 1]!.value;

    const p1 = before[before.length - 1]!;
    const p2 = after[0]!;

    if (p2.beat === p1.beat) {
        return p1.value;
    }

    if (p1.curve === "step") {
        return p1.value;
    }

    const t = (beat - p1.beat) / (p2.beat - p1.beat);

    if (p1.curve === "exponential") {
        const expT = t * t;
        return p1.value + (p2.value - p1.value) * expT;
    }

    return p1.value + (p2.value - p1.value) * t;
};
