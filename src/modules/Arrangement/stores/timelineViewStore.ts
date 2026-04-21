import { createStore } from '#/infra/store/createStore';

import { trackStore } from './trackStore';

export type TimelineViewState = {
    scrollX: number;
    scrollY: number;
    pixelsPerBeat: number;
    autoScrollEnabled: boolean;
};

export const timelineViewStore = createStore<TimelineViewState>({
    initialData: {
        scrollX: 0,
        scrollY: 0,
        pixelsPerBeat: 12,
        autoScrollEnabled: true,
    },
});

export function zoomTimeline(delta: number): void {
    const state = timelineViewStore.value;
    if (!state) {
        return;
    }
    const newPpb = Math.max(2, Math.min(80, state.pixelsPerBeat + delta));
    timelineViewStore.set({ ...state, pixelsPerBeat: newPpb });
}

export function scrollTimeline(deltaX: number): void {
    const state = timelineViewStore.value;
    if (!state) {
        return;
    }
    timelineViewStore.set({ ...state, scrollX: Math.max(0, state.scrollX + deltaX) });
}

export function setScrollX(scrollX: number): void {
    const state = timelineViewStore.value;
    if (!state) {
        return;
    }
    timelineViewStore.set({ ...state, scrollX: Math.max(0, scrollX) });
}

export function setAutoScroll(enabled: boolean): void {
    const state = timelineViewStore.value;
    if (!state) {
        return;
    }
    timelineViewStore.set({ ...state, autoScrollEnabled: enabled });
}

export function toggleAutoScroll(): void {
    const state = timelineViewStore.value;
    if (!state) {
        return;
    }
    timelineViewStore.set({ ...state, autoScrollEnabled: !state.autoScrollEnabled });
}

export function setScrollY(scrollY: number, viewportHeight = 200): void {
    const state = timelineViewStore.value;
    if (!state) {
        return;
    }
    // Clamp to prevent scrolling past the last track.
    // viewportHeight is the visible track area height — callers should pass
    // the actual container height for correct clamping.
    const tracks = trackStore.value?.tracks ?? [];
    const totalHeight = tracks
        .filter((time) => time.kind !== 'master')
        .reduce((sum, time) => sum + (time.height ?? 64), 0);
    const maxY = Math.max(0, totalHeight - viewportHeight);
    const clamped = Math.max(0, Math.min(maxY, scrollY));
    if (state.scrollY !== clamped) {
        timelineViewStore.set({ ...state, scrollY: clamped });
    }
}
