import { createMarker } from '../../../models/Marker';
import { markerStore } from '../../../stores/markerStore';

export function addMarker(beat: number, name: string, markerId?: string, color?: string): boolean {
    const state = markerStore.value;
    if (!state) {
        return false;
    }
    const base = createMarker(beat, name);
    // Optional caller-supplied identity/color let undo restore the exact marker
    // (removeMarker's inverse) instead of a lookalike with a fresh id.
    const marker = { ...base, id: markerId ?? base.id, color: color ?? base.color };
    markerStore.set({ ...state, markers: [...state.markers, marker] });
    return true;
}
