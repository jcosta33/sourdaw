import { getMarkerState } from '#/modules/Arrangement/useCases';
import { getTransportStoreValue, seekPlayhead } from '#/modules/Transport/useCases';

export function goToNextMarker(): void {
    const markers = getMarkerState()?.markers;
    const playhead = getTransportStoreValue()?.playheadPosition ?? 0;
    if (!markers || markers.length === 0) {
        return;
    }
    const sorted = [...markers].sort((a, b) => a.beat - b.beat);
    const next = sorted.find((m) => m.beat > playhead);
    if (next) {
        seekPlayhead(next.beat);
    }
}
