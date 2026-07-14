import { sanitize_tempo_map_state, tempoMapStore } from '../stores/tempoMapStore';
import { sanitize_time_signature_map_state, timeSignatureMapStore } from '../stores/timeSignatureMapStore';

type RestoreTimelineMapSnapshotInput = {
    tempoMap?: unknown;
    timeSignatureMap?: unknown;
};

export function restoreTimelineMapSnapshot(input: RestoreTimelineMapSnapshotInput): void {
    tempoMapStore.set(sanitize_tempo_map_state(input.tempoMap));
    timeSignatureMapStore.set(sanitize_time_signature_map_state(input.timeSignatureMap));
}
