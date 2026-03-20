import { automationStore } from '../stores/automationStore';
import { type AutomationPoint, createAutomationObject } from '../models/Automation';
import { pushUndoEntry } from '#/modules/Command/useCases/pushUndoEntry';

/**
 * Create an automation object from existing lane points within a range.
 * Captures points in [startBeat, endBeat] and moves them into the object.
 */
export function createObjectFromRange(laneId: string, startBeat: number, endBeat: number, name?: string): string | null {
    const state = automationStore.value;
    if (!state) {
        return null;
    }

    const lane = state.lanes.find((l) => l.id === laneId);
    if (!lane) {
        return null;
    }

    const capturedPoints = lane.points
        .filter((p) => p.beat >= startBeat && p.beat <= endBeat)
        .map((p) => ({ ...p, beat: p.beat - startBeat })); // Normalize to object-local beats

    const obj = createAutomationObject(laneId, startBeat, endBeat, capturedPoints, name);

    const previousPoints = [...lane.points];
    const remainingPoints = lane.points.filter((p) => p.beat < startBeat || p.beat > endBeat);

    automationStore.set({
        lanes: state.lanes.map((l) =>
            l.id === laneId
                ? { ...l, points: remainingPoints, objects: [...l.objects, obj] }
                : l
        ),
    });

    pushUndoEntry(
        'Create automation object',
        () => {
            const s = automationStore.value;
            if (!s) {
                return;
            }
            automationStore.set({
                lanes: s.lanes.map((l) =>
                    l.id === laneId
                        ? { ...l, points: previousPoints, objects: l.objects.filter((o) => o.id !== obj.id) }
                        : l
                ),
            });
        },
        () => {
            const s = automationStore.value;
            if (!s) {
                return;
            }
            automationStore.set({
                lanes: s.lanes.map((l) =>
                    l.id === laneId
                        ? { ...l, points: remainingPoints, objects: [...l.objects, obj] }
                        : l
                ),
            });
        }
    );

    return obj.id;
}

/**
 * Move an automation object to a new beat position.
 */
export function moveAutomationObject(laneId: string, objectId: string, newStartBeat: number): void {
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
                objects: l.objects.map((o) => {
                    if (o.id !== objectId) {
                        return o;
                    }
                    const duration = o.endBeat - o.startBeat;
                    return { ...o, startBeat: newStartBeat, endBeat: newStartBeat + duration };
                }),
            };
        }),
    });
}

/**
 * Create a pooled (linked) copy of an automation object.
 * Pooled copies share the same poolId and update simultaneously.
 */
export function poolAutomationObject(laneId: string, objectId: string, targetBeat: number): string | null {
    const state = automationStore.value;
    if (!state) {
        return null;
    }

    const lane = state.lanes.find((l) => l.id === laneId);
    if (!lane) {
        return null;
    }

    const source = lane.objects.find((o) => o.id === objectId);
    if (!source) {
        return null;
    }

    const poolId = source.poolId ?? source.id; // Use existing poolId or create from source
    const duration = source.endBeat - source.startBeat;

    const copy = createAutomationObject(
        laneId,
        targetBeat,
        targetBeat + duration,
        source.points.map((p) => ({ ...p })),
        `${source.name} (pooled)`
    );
    copy.poolId = poolId;

    // Update source to have poolId if it didn't
    automationStore.set({
        lanes: state.lanes.map((l) => {
            if (l.id !== laneId) {
                return l;
            }
            return {
                ...l,
                objects: [
                    ...l.objects.map((o) => (o.id === objectId ? { ...o, poolId } : o)),
                    copy,
                ],
            };
        }),
    });

    return copy.id;
}

/**
 * Stretch an automation object to a new end beat. Points are scaled proportionally.
 */
export function stretchAutomationObject(laneId: string, objectId: string, newEndBeat: number): void {
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
                objects: l.objects.map((o) => {
                    if (o.id !== objectId) {
                        return o;
                    }
                    const oldDuration = o.endBeat - o.startBeat;
                    const newDuration = newEndBeat - o.startBeat;
                    if (oldDuration <= 0 || newDuration <= 0) {
                        return o;
                    }
                    const scale = newDuration / oldDuration;
                    return {
                        ...o,
                        endBeat: newEndBeat,
                        points: o.points.map((p) => ({ ...p, beat: p.beat * scale })),
                    };
                }),
            };
        }),
    });
}

/**
 * Set loop length for an automation object (content repeats at this interval).
 */
export function loopAutomationObject(laneId: string, objectId: string, loopLength: number | undefined): void {
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
                objects: l.objects.map((o) =>
                    o.id === objectId ? { ...o, loopLength } : o
                ),
            };
        }),
    });
}

/**
 * Delete an automation object. Optionally releases points back to the lane.
 */
export function deleteAutomationObject(laneId: string, objectId: string, releasePoints = false): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const lane = state.lanes.find((l) => l.id === laneId);
    if (!lane) {
        return;
    }

    const obj = lane.objects.find((o) => o.id === objectId);
    if (!obj) {
        return;
    }

    const releasedPoints: AutomationPoint[] = releasePoints
        ? obj.points.map((p) => ({ ...p, beat: p.beat + obj.startBeat }))
        : [];

    automationStore.set({
        lanes: state.lanes.map((l) => {
            if (l.id !== laneId) {
                return l;
            }
            return {
                ...l,
                objects: l.objects.filter((o) => o.id !== objectId),
                points: releasePoints
                    ? [...l.points, ...releasedPoints].sort((a, b) => a.beat - b.beat)
                    : l.points,
            };
        }),
    });

    pushUndoEntry(
        'Delete automation object',
        () => {
            const s = automationStore.value;
            if (!s) {
                return;
            }
            automationStore.set({
                lanes: s.lanes.map((l) => {
                    if (l.id !== laneId) {
                        return l;
                    }
                    return {
                        ...l,
                        objects: [...l.objects, obj],
                        points: releasePoints
                            ? l.points.filter((p) => !releasedPoints.some((rp) => Math.abs(rp.beat - p.beat) < 0.001))
                            : l.points,
                    };
                }),
            });
        },
        () => {
            const s = automationStore.value;
            if (!s) {
                return;
            }
            automationStore.set({
                lanes: s.lanes.map((l) => {
                    if (l.id !== laneId) {
                        return l;
                    }
                    return {
                        ...l,
                        objects: l.objects.filter((o) => o.id !== objectId),
                        points: releasePoints
                            ? [...l.points, ...releasedPoints].sort((a, b) => a.beat - b.beat)
                            : l.points,
                    };
                }),
            });
        }
    );
}
