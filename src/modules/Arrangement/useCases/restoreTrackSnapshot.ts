import { sanitizeTrackSnapshot, trackStore } from '../stores/trackStore';

import { migrateLegacyFrozenTrackStates } from './freezeBounce/migrateLegacyFrozenTrackStates';

export function restoreTrackSnapshot(snapshot: unknown): void {
    const normalized_snapshot = sanitizeTrackSnapshot(snapshot);

    trackStore.set({
        tracks: migrateLegacyFrozenTrackStates(normalized_snapshot.tracks),
        selectedTrackId: normalized_snapshot.selectedTrackId,
    });
}
