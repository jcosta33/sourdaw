/**
 * Timeline Queries — use case layer exposing timeline view state
 * to cross-module consumers.
 */

import { markerStore, type MarkerStoreState } from '../stores/markerStore';

export type { MarkerStoreState };

/** Get the current marker store state. */
export function getMarkerState(): MarkerStoreState | null {
    return markerStore.value;
}
