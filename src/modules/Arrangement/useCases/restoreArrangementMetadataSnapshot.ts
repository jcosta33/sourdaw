import { markerStore, sanitize_marker_store_state } from '../stores/markerStore';
import { takeLaneStore, sanitize_take_lane_store_state } from '../stores/takeLaneStore';

type RestoreArrangementMetadataSnapshotInput = {
    markers?: unknown;
    takeLanes?: unknown;
};

export function restoreArrangementMetadataSnapshot(input: RestoreArrangementMetadataSnapshotInput): void {
    markerStore.set(sanitize_marker_store_state(input.markers));
    takeLaneStore.set(sanitize_take_lane_store_state(input.takeLanes));
}
