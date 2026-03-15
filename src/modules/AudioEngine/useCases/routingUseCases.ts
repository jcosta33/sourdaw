import { audioGraphStore } from "../stores/audioGraphStore";
import type { AudioRoute } from "../models/AudioGraph";

export const addRoute = (sourceId: string, destinationId: string, gain = 1): void => {
    const state = audioGraphStore.value;
    if (!state) return;

    const exists = state.routes.some(
        (r) => r.sourceId === sourceId && r.destinationId === destinationId,
    );
    if (exists) return;

    const route: AudioRoute = { sourceId, destinationId, gain };
    audioGraphStore.set({ routes: [...state.routes, route] });
};

export const removeRoute = (sourceId: string, destinationId: string): void => {
    const state = audioGraphStore.value;
    if (!state) return;
    audioGraphStore.set({
        routes: state.routes.filter(
            (r) => !(r.sourceId === sourceId && r.destinationId === destinationId),
        ),
    });
};

export const setRouteGain = (sourceId: string, destinationId: string, gain: number): void => {
    const state = audioGraphStore.value;
    if (!state) return;
    audioGraphStore.set({
        routes: state.routes.map((r) =>
            r.sourceId === sourceId && r.destinationId === destinationId
                ? { ...r, gain }
                : r,
        ),
    });
};

export const getRoutesForTrack = (trackId: string): AudioRoute[] => {
    const state = audioGraphStore.value;
    if (!state) return [];
    return state.routes.filter((r) => r.sourceId === trackId);
};

export const getInputsForTrack = (trackId: string): AudioRoute[] => {
    const state = audioGraphStore.value;
    if (!state) return [];
    return state.routes.filter((r) => r.destinationId === trackId);
};
