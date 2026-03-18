import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';

const logger = Container.getInstance().get(Logger);

export type TimelineViewState = {
    scrollX: number;
    scrollY: number;
    pixelsPerBeat: number;
    autoScrollEnabled: boolean;
};

export const timelineViewStore = new Store<TimelineViewState>(logger, {
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

export function setScrollY(scrollY: number): void {
    const state = timelineViewStore.value;
    if (!state) {
        return;
    }
    if (state.scrollY !== scrollY) {
        timelineViewStore.set({ ...state, scrollY });
    }
}
