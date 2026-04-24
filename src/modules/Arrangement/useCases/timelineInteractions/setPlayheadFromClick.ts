import { transportStore } from '#/modules/Transport/stores';

import { timelineViewStore } from '../../stores/timelineViewStore';

export function setPlayheadFromClick(canvasX: number): void {
    const viewState = timelineViewStore.value;
    const transport = transportStore.value;
    if (!viewState || !transport) {
        return;
    }

    const beat = canvasX / viewState.pixelsPerBeat + viewState.scrollX / viewState.pixelsPerBeat;
    transportStore.set({ ...transport, playheadPosition: Math.max(0, beat) });
}
