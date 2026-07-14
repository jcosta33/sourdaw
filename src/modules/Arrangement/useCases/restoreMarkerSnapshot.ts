import { markerStore, sanitize_marker_store_state } from '../stores/markerStore';

export function restoreMarkerSnapshot(snapshot: unknown): void {
    markerStore.set(sanitize_marker_store_state(snapshot));
}
