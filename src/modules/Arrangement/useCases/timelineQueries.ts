import { markerStore, type MarkerStoreState } from '../stores/markerStore';

export type { MarkerStoreState };

export function getMarkerState(): MarkerStoreState | null {
    return markerStore.value;
}
