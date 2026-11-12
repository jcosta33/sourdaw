import { seekPlayhead } from '#/modules/Transport/useCases';

import { timelineViewStore } from '../../stores/timelineViewStore';

export function setPlayheadFromClick(canvasX: number): void {
    const viewState = timelineViewStore.value;
    if (!viewState) {
        return;
    }

    const beat = canvasX / viewState.pixelsPerBeat + viewState.scrollX / viewState.pixelsPerBeat;
    void seekPlayhead(Math.max(0, beat));
}
