import { createStore } from '#/infra/store/createStore';

import { trackStore } from './trackStore';

export type TimelineViewState = {
    scrollX: number;
    scrollY: number;
    pixelsPerBeat: number;
    autoScrollEnabled: boolean;
    /**
     * The real, currently-visible track-list viewport height in pixels, as
     * last reported by a mounted view via {@link setTimelineViewportHeight}.
     * Optional (and treated as `0` when absent) so the many pre-existing
     * `useStore(timelineViewStore, { ...fallback })` call sites across other
     * modules — which predate this field and are out of this module's scope
     * to edit — keep type-checking without having to name it. `0` (or
     * absent) under-clamps rather than assuming a viewport size no caller
     * actually has, which was the F7 defect: `setScrollY` used to default an
     * unset viewport height to a hardcoded `200`, mis-clamping every caller
     * whose real container was a different height.
     */
    viewportHeight?: number;
};

export const timelineViewStore = createStore<TimelineViewState>({
    initialData: {
        scrollX: 0,
        scrollY: 0,
        pixelsPerBeat: 12,
        autoScrollEnabled: true,
        viewportHeight: 0,
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

/**
 * Records the real, currently-visible track-list viewport height so
 * {@link setScrollY} can clamp against it. Call this from whichever view
 * owns the scrollable container, with its real measured height (e.g.
 * `el.clientHeight`), whenever that height is known to have changed.
 */
export function setTimelineViewportHeight(viewportHeight: number): void {
    const state = timelineViewStore.value;
    if (!state || (state.viewportHeight ?? 0) === viewportHeight) {
        return;
    }
    timelineViewStore.set({ ...state, viewportHeight });
}

/**
 * F7 — the shared `viewportHeight` field is written by exactly one caller
 * (`TrackListView`, via {@link setTimelineViewportHeight}), so it is only
 * ever correct for that view's own clamp. A second scrollable view (the
 * automation panel) must not clamp against it: doing so makes its scroll
 * ceiling depend on an unrelated view's size, and — because a mounted
 * `TrackListView` also *reads* `scrollY` back to sync its own native
 * `scrollTop` — a clamp computed from the wrong viewport can write a
 * `scrollY` that visibly desyncs the track list's real scroll position.
 *
 * `viewportHeightOverride` lets a caller that owns its own scrollable
 * container (and measures its own real height, e.g. from the wheel event's
 * `currentTarget`) clamp against that height directly instead, without
 * writing it into the shared field and without disturbing `TrackListView`'s
 * own no-argument call, which keeps using `state.viewportHeight` exactly as
 * before.
 */
export function setScrollY(scrollY: number, viewportHeightOverride?: number): void {
    const state = timelineViewStore.value;
    if (!state) {
        return;
    }
    // Clamp to prevent scrolling past the last track, against the real
    // viewport height the store was last told about (see
    // `setTimelineViewportHeight`) rather than an assumed constant — unless
    // the caller supplied its own real height, in which case that value is
    // authoritative for this call.
    const viewportHeight = viewportHeightOverride ?? state.viewportHeight ?? 0;
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
