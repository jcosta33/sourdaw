import { adjustmentLayerStore } from '../stores/adjustmentLayer';
import { markerStore } from '../stores/markerStore';
import { takeLaneStore } from '../stores/takeLaneStore';
import { trackStore } from '../stores/trackStore';

export function resetArrangementStoresForProject(): void {
    adjustmentLayerStore.set({ layers: [] });
    trackStore.set({ tracks: [], selectedTrackId: null });
    markerStore.set({ markers: [], sections: [] });
    takeLaneStore.set({ lanes: [] });
}
