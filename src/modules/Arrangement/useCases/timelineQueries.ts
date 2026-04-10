import { inject } from '#/infra/di/inject';
import { markerStore, type MarkerStoreState } from '../stores/markerStore';

export type { MarkerStoreState };

/** Get the current marker store state. */
export const getMarkerState = inject({ markerStore })(
    ({ markerStore: markers }) =>
        function getMarkerState(): MarkerStoreState | null {
            return markers.value;
        }
);
