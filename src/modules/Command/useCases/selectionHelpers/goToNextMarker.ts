import { getMarkerState } from '#/modules/Arrangement/useCases';
import { getTransportStoreValue, seekPlayhead } from '#/modules/Transport/useCases';

export function goToNextMarker(): void {
    const markers = getMarkerState()?.markers;
    const playhead = getTransportStoreValue()?.playheadPosition ?? 0;
    if (!markers || markers.length === 0) {
        return;
    }
    const sorted = [...markers].sort((alpha, b) => alpha.beat - b.beat);
    const next = sorted.find((message) => message.beat > playhead);
    if (next) {
        seekPlayhead(next.beat);
    }
}
