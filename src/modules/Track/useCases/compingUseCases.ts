import { takeLaneStore } from '../stores/takeLaneStore';
import { createTake, createTakeLane, type CompRegion } from '../models/TakeLane';

export function addTakeLane(trackId: string): void {
    const state = takeLaneStore.value;
    if (!state) {
        return;
    }

    const exists = state.lanes.some((l) => l.trackId === trackId);
    if (exists) {
        return;
    }

    takeLaneStore.set({
        lanes: [...state.lanes, createTakeLane(trackId)],
    });
}

export function addTake(trackId: string, clipId: string, name: string, startBeat: number, endBeat: number): void {
    const state = takeLaneStore.value;
    if (!state) {
        return;
    }

    const take = createTake(clipId, name, startBeat, endBeat);

    takeLaneStore.set({
        lanes: state.lanes.map((l) => (l.trackId === trackId ? { ...l, takes: [...l.takes, take] } : l)),
    });
}

export function selectTake(trackId: string, takeId: string): void {
    const state = takeLaneStore.value;
    if (!state) {
        return;
    }

    takeLaneStore.set({
        lanes: state.lanes.map((l) =>
            l.trackId === trackId
                ? {
                      ...l,
                      takes: l.takes.map((t) => ({
                          ...t,
                          selected: t.id === takeId,
                      })),
                  }
                : l
        ),
    });
}

export function setCompRegion(trackId: string, region: CompRegion): void {
    const state = takeLaneStore.value;
    if (!state) {
        return;
    }

    takeLaneStore.set({
        lanes: state.lanes.map((l) => {
            if (l.trackId !== trackId) {
                return l;
            }

            const filtered = l.activeCompRegions.filter(
                (r) => r.endBeat <= region.startBeat || r.startBeat >= region.endBeat
            );

            return {
                ...l,
                activeCompRegions: [...filtered, region].sort((a, b) => a.startBeat - b.startBeat),
            };
        }),
    });
}

export function getTakeLaneForTrack(trackId: string) {
    const state = takeLaneStore.value;
    if (!state) {
        return null;
    }
    return state.lanes.find((l) => l.trackId === trackId) ?? null;
}

export function flattenComp(trackId: string): void {
    const state = takeLaneStore.value;
    if (!state) {
        return;
    }

    takeLaneStore.set({
        lanes: state.lanes.filter((l) => l.trackId !== trackId),
    });
}
