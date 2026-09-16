import { markerStore, sanitize_marker_store_state } from '../stores/markerStore';
import { takeLaneStore, sanitize_take_lane_store_state } from '../stores/takeLaneStore';
import { runWithTakeLaneWriteIntent } from '../stores/takeLaneWriteJournal';

type RestoreArrangementMetadataSnapshotInput = {
    markers?: unknown;
    takeLanes?: unknown;
};

export function restoreArrangementMetadataSnapshot(input: RestoreArrangementMetadataSnapshotInput): void {
    markerStore.set(sanitize_marker_store_state(input.markers));
    runWithTakeLaneWriteIntent({ kind: 'replace-state' }, () => {
        takeLaneStore.set(sanitize_take_lane_store_state(input.takeLanes));
    });
}
