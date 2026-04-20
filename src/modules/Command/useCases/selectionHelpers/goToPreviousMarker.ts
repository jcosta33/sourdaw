import { getMarkerState } from '#/modules/Arrangement/useCases';
import { getTransportStoreValue, seekPlayhead } from '#/modules/Transport/useCases';

export function goToPreviousMarker(): void {
    const markers = getMarkerState()?.markers;
    const playhead = getTransportStoreValue()?.playheadPosition ?? 0;
    if (!markers || markers.length === 0) {
        return;
    }
    const sorted = [...markers].sort((a, b) => b.beat - a.beat);
    const prev = sorted.find((m) => m.beat < playhead);
    if (prev) {
        seekPlayhead(prev.beat);
    }
}
