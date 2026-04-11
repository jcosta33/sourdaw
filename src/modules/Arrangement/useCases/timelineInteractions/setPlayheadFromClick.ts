import { getTransportState, updateTransportState } from '#/modules/Transport/useCases';
import { timelineViewStore } from '../../stores/timelineViewStore';

export function setPlayheadFromClick(canvasX: number): void {
    const viewState = timelineViewStore.value;
    const transport = getTransportState();
    if (!viewState || !transport) {
        return;
    }

    const beat = canvasX / viewState.pixelsPerBeat + viewState.scrollX / viewState.pixelsPerBeat;
    updateTransportState({ playheadPosition: Math.max(0, beat) });
}
