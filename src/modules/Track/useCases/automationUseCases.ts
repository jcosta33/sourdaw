import { automationStore } from '../stores/automationStore';
import { createAutomationLane, type AutomationPoint } from '../models/Automation';
import { rdpSimplify, interpolateAutomationValue } from '../transformers/automationTransformers';

export function addAutomationLane(trackId: string, parameterId: string, parameterName: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const exists = state.lanes.some((l) => l.trackId === trackId && l.parameterId === parameterId);
    if (exists) {
        return;
    }

    automationStore.set({
        lanes: [...state.lanes, createAutomationLane(trackId, parameterId, parameterName)],
    });
}

export function removeAutomationLane(laneId: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.filter((l) => l.id !== laneId),
    });
}

export function toggleAutomationVisibility(laneId: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((l) => (l.id === laneId ? { ...l, visible: !l.visible } : l)),
    });
}

export function addAutomationPoint(laneId: string, point: AutomationPoint): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((l) =>
            l.id === laneId
                ? {
                      ...l,
                      points: [...l.points, point].sort((a, b) => a.beat - b.beat),
                  }
                : l
        ),
    });
}

export function removeAutomationPoint(laneId: string, beat: number): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((l) =>
            l.id === laneId ? { ...l, points: l.points.filter((p) => p.beat !== beat) } : l
        ),
    });
}

export function updateAutomationPoint(laneId: string, beat: number, newValue: number, newBeat?: number): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((l) => {
            if (l.id !== laneId) {
                return l;
            }
            const updated = l.points.map((p) =>
                p.beat === beat ? { ...p, value: newValue, beat: newBeat ?? p.beat } : p
            );
            return { ...l, points: updated.sort((a, b) => a.beat - b.beat) };
        }),
    });
}

export function batchAddAutomationPoints(laneId: string, points: AutomationPoint[]): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((l) => {
            if (l.id !== laneId) {
                return l;
            }
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
}

export function addClipAutomationLane(
    trackId: string,
    clipId: string,
    parameterId: string,
    parameterName: string
): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const exists = state.lanes.some((l) => l.clipId === clipId && l.parameterId === parameterId);
    if (exists) {
        return;
    }

    automationStore.set({
        lanes: [...state.lanes, createAutomationLane(trackId, parameterId, parameterName, 0, 1, clipId)],
    });
}

export function shiftClipAutomation(clipId: string, beatDelta: number): void {
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
}

export function duplicateClipAutomation(sourceClipId: string, newClipId: string): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const sourceLanes = state.lanes.filter((l) => l.clipId === sourceClipId);
    if (sourceLanes.length === 0) {
        return;
    }

    const newLanes = sourceLanes
        .map((lane) =>
            createAutomationLane(
                lane.trackId,
                lane.parameterId,
                lane.parameterName,
                lane.minValue,
                lane.maxValue,
                newClipId
            )
        )
        .map((newLane, i) => ({
            ...newLane,
            points: sourceLanes[i]!.points.map((p) => ({ ...p })),
            visible: sourceLanes[i]!.visible,
        }));

    automationStore.set({
        lanes: [...state.lanes, ...newLanes],
    });
}

export function scaleAutomationValues(laneId: string, factor: number, anchor = 0): void {
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
                    value: Math.min(lane.maxValue, Math.max(lane.minValue, anchor + (p.value - anchor) * factor)),
                })),
            };
        }),
    });
}

export function stretchAutomationTime(laneId: string, factor: number, anchorBeat = 0): void {
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
}

export function invertAutomation(laneId: string): void {
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
}

export function reverseAutomation(laneId: string): void {
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
                points: lane.points.map((p) => ({ ...p, beat: maxBeat - p.beat })).sort((a, b) => a.beat - b.beat),
            };
        }),
    });
}

export function thinAutomationPoints(laneId: string, tolerance = 0.01): void {
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
}

export function quantizeAutomationBeats(laneId: string, gridSize: number): void {
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
}

export function setAutomationPointCurve(
    laneId: string,
    beat: number,
    curve: AutomationPoint['curve'],
    tension = 0.5
): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }
    automationStore.set({
        lanes: state.lanes.map((l) => {
            if (l.id !== laneId) {
                return l;
            }
            return {
                ...l,
                points: l.points.map((p) => (Math.abs(p.beat - beat) < 0.05 ? { ...p, curve, tension } : p)),
            };
        }),
    });
}

export function getAutomationValueAtBeat(laneId: string, beat: number): number | null {
    const state = automationStore.value;
    if (!state) {
        return null;
    }

    const lane = state.lanes.find((l) => l.id === laneId);
    if (!lane || lane.points.length === 0) {
        return null;
    }

    const before = lane.points.filter((p) => p.beat <= beat);
    const after = lane.points.filter((p) => p.beat > beat);

    if (before.length === 0) {
        return lane.points[0]!.value;
    }
    if (after.length === 0) {
        return before[before.length - 1]!.value;
    }

    return interpolateAutomationValue(before[before.length - 1]!, after[0]!, beat);
}
