import { Container } from "#/helpers/DependencyInjector/Container";
import { Logger } from "#/helpers/Logger/Logger";
import { Store } from "#/helpers/Store/Store";

const logger = Container.getInstance().get(Logger);

export type TimelineViewState = {
    scrollX: number;
    pixelsPerBeat: number;
};

export const timelineViewStore = new Store<TimelineViewState>(logger, {
    initialData: {
        scrollX: 0,
        pixelsPerBeat: 12,
    },
});

export const zoomTimeline = (delta: number): void => {
    const state = timelineViewStore.value;
    if (!state) return;
    const newPpb = Math.max(2, Math.min(80, state.pixelsPerBeat + delta));
    timelineViewStore.set({ ...state, pixelsPerBeat: newPpb });
};

export const scrollTimeline = (deltaX: number): void => {
    const state = timelineViewStore.value;
    if (!state) return;
    timelineViewStore.set({ ...state, scrollX: Math.max(0, state.scrollX + deltaX) });
};
