import { markerStore } from '../stores/markerStore';
import { takeLaneStore } from '../stores/takeLaneStore';
import { trackStore } from '../stores/trackStore';

export function resetArrangementStoresForProject(): void {
    trackStore.set({ tracks: [], selectedTrackId: null });
    markerStore.set({ markers: [], sections: [] });
    takeLaneStore.set({ lanes: [] });
}
