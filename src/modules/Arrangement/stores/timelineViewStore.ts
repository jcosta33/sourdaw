import { createStore } from '#/infra/store/createStore';

import { getTimelineHorizontalContentWidth } from '../models/TimelineHorizontalExtent';
import { getTimelineContentHeight } from '../transformers/getTimelineContentHeight';

import { trackStore } from './trackStore';

export type TimelineViewState = {
    scrollX: number;
    scrollY: number;
    pixelsPerBeat: number;
    autoScrollEnabled: boolean;
    /**
     * The real, currently-visible timeline canvas viewport in CSS pixels. Zero
     * means the canvas has not measured itself yet; horizontal clamping then
     * retains the legacy lower bound rather than inventing a width.
     */
    viewportWidth?: number;
    /**
     * The real, currently-visible timeline canvas viewport height in pixels,
     * as last reported by the canvas owner via {@link setTimelineViewportHeight}.
     * Optional (and treated as `0` when absent) so existing fallback states keep
     * type-checking without having to name it.
     */
    viewportHeight?: number;
};

export type TimelineWorkingView = Pick<TimelineViewState, 'scrollX' | 'scrollY' | 'pixelsPerBeat'>;

export const timelineViewStore = createStore<TimelineViewState>({
    initialData: {
        scrollX: 0,
        scrollY: 0,
        pixelsPerBeat: 12,
        autoScrollEnabled: true,
        viewportWidth: 0,
        viewportHeight: 0,
    },
});

function clampPixelsPerBeat(pixelsPerBeat: number): number {
    return Math.max(2, Math.min(80, pixelsPerBeat));
}

function clampScrollX(scrollX: number, pixelsPerBeat: number, viewportWidth: number): number {
    const nonNegative = Math.max(0, scrollX);
    if (viewportWidth <= 0) {
        return nonNegative;
    }
    const contentWidth = getTimelineHorizontalContentWidth(trackStore.value?.tracks ?? [], pixelsPerBeat);
    return Math.min(Math.max(0, contentWidth - viewportWidth), nonNegative);
}

function clampScrollY(scrollY: number, viewportHeight: number): number {
    const totalHeight = getTimelineContentHeight(trackStore.value?.tracks ?? []);
    const maxY = Math.max(0, totalHeight - viewportHeight);
    return Math.max(0, Math.min(maxY, scrollY));
}

export function zoomTimeline(delta: number): void {
    const state = timelineViewStore.value;
    if (!state) {
        return;
    }
    const pixelsPerBeat = clampPixelsPerBeat(state.pixelsPerBeat + delta);
    timelineViewStore.set({
        ...state,
        pixelsPerBeat,
        scrollX: clampScrollX(state.scrollX, pixelsPerBeat, state.viewportWidth ?? 0),
    });
}

/**
 * Sets an absolute zoom level and derives horizontal scroll from a scroll
 * target in beats, using the clamped zoom so the two cannot disagree.
 * Other fields are untouched.
 */
export function setTimelineZoom(pixelsPerBeat: number, scrollStartBeat: number): void {
    const state = timelineViewStore.value;
    if (!state) {
        return;
    }
    const clampedPixelsPerBeat = clampPixelsPerBeat(pixelsPerBeat);
    timelineViewStore.set({
        ...state,
        pixelsPerBeat: clampedPixelsPerBeat,
        scrollX: clampScrollX(scrollStartBeat * clampedPixelsPerBeat, clampedPixelsPerBeat, state.viewportWidth ?? 0),
    });
}

export function scrollTimeline(deltaX: number): void {
    const state = timelineViewStore.value;
    if (!state) {
        return;
    }
    setScrollX(state.scrollX + deltaX);
}

export function setScrollX(scrollX: number): void {
    const state = timelineViewStore.value;
    if (!state) {
        return;
    }
    const clamped = clampScrollX(scrollX, state.pixelsPerBeat, state.viewportWidth ?? 0);
    if (state.scrollX !== clamped) {
        timelineViewStore.set({ ...state, scrollX: clamped });
    }
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

/** Record both canvas dimensions and pull restored offsets into their new range. */
export function setTimelineViewportSize({
    viewportWidth,
    viewportHeight,
}: {
    viewportWidth: number;
    viewportHeight: number;
}): void {
    const state = timelineViewStore.value;
    if (!state || ((state.viewportWidth ?? 0) === viewportWidth && (state.viewportHeight ?? 0) === viewportHeight)) {
        return;
    }
    timelineViewStore.set({
        ...state,
        viewportWidth,
        viewportHeight,
        scrollX: clampScrollX(state.scrollX, state.pixelsPerBeat, viewportWidth),
        scrollY: clampScrollY(state.scrollY, viewportHeight),
    });
}

/**
 * Records the real, currently-visible timeline canvas viewport height so
 * {@link setScrollY} can clamp against it. The timeline canvas owner reports
 * both dimensions through {@link setTimelineViewportSize}; this remains for
 * callers that only know the height.
 */
export function setTimelineViewportHeight(viewportHeight: number): void {
    const state = timelineViewStore.value;
    if (!state) {
        return;
    }
    setTimelineViewportSize({ viewportWidth: state.viewportWidth ?? 0, viewportHeight });
}

/**
 * The shared `viewportHeight` is written only by the timeline canvas. A second
 * scrollable view must not clamp against it: the automation panel supplies its
 * own measured height per call, otherwise its scroll ceiling depends on an
 * unrelated view and can desynchronize the track list's native scroll position.
 * With no override, the track list and canvas continue sharing the canvas height.
 */
export function setScrollY(scrollY: number, viewportHeightOverride?: number): void {
    const state = timelineViewStore.value;
    if (!state) {
        return;
    }
    const viewportHeight = viewportHeightOverride ?? state.viewportHeight ?? 0;
    const clamped = clampScrollY(scrollY, viewportHeight);
    if (state.scrollY !== clamped) {
        timelineViewStore.set({ ...state, scrollY: clamped });
    }
}

/** Restore only persistent view fields; measurements stay owned by the live canvas. */
export function replaceTimelineWorkingView(
    view: TimelineWorkingView | null,
    { deferViewportClamp = false }: { deferViewportClamp?: boolean } = {}
): void {
    const state = timelineViewStore.value;
    if (!state) {
        return;
    }
    const pixelsPerBeat = clampPixelsPerBeat(view?.pixelsPerBeat ?? 12);
    timelineViewStore.set({
        ...state,
        pixelsPerBeat,
        scrollX: clampScrollX(view?.scrollX ?? 0, pixelsPerBeat, deferViewportClamp ? 0 : (state.viewportWidth ?? 0)),
        scrollY: deferViewportClamp
            ? Math.max(0, view?.scrollY ?? 0)
            : clampScrollY(view?.scrollY ?? 0, state.viewportHeight ?? 0),
        autoScrollEnabled: view ? state.autoScrollEnabled : true,
    });
}
