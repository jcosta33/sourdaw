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

    if (p1.curve === "step") return p1.value;

    const t = (beat - p1.beat) / (p2.beat - p1.beat);
    return p1.value + (p2.value - p1.value) * t;
};
