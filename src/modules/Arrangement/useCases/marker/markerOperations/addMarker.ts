import { type ListRestoreSlot, insertAtListRestoreSlot } from '../../../models/ListRestoreSlot';
import { createMarker } from '../../../models/Marker';
import { markerStore } from '../../../stores/markerStore';

export function addMarker(
    beat: number,
    name: string,
    markerId?: string,
    color?: string,
    slot: ListRestoreSlot = {}
): boolean {
    const state = markerStore.value;
    if (!state) {
        return false;
    }
    const base = createMarker(beat, name);
    // Optional caller-supplied identity/color let undo restore the exact marker
    // (removeMarker's inverse) instead of a lookalike with a fresh id.
    const marker = { ...base, id: markerId ?? base.id, color: color ?? base.color };
    // Marker array order is project truth (MarkerLane renders and hit-tests in it),
    // so removeMarker's inverse restores the original neighbours (see ListRestoreSlot).
    markerStore.set({ ...state, markers: insertAtListRestoreSlot(state.markers, marker, slot) });
    return true;
}
