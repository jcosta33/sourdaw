import { sanitizeTrackSnapshot, trackStore } from '../stores/trackStore';

export function restoreTrackSnapshot(snapshot: unknown): void {
    const normalized_snapshot = sanitizeTrackSnapshot(snapshot);

    trackStore.set({
        tracks: normalized_snapshot.tracks,
        selectedTrackId: normalized_snapshot.selectedTrackId,
    });
}
