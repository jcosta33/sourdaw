import { readLegacyChordTrackStorage } from '../repositories/readLegacyChordTrackStorage';
import { isChordTrackState } from '../stores/chordTrackStore';

export function readLegacyChordTrackMigration() {
    const legacyStorage = readLegacyChordTrackStorage();
    if (!legacyStorage) {
        return null;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(legacyStorage.raw);
    } catch {
        return null;
    }
    if (!isChordTrackState(parsed)) {
        return null;
    }

    return {
        action: {
            type: 'restoreChordTrackState' as const,
            payload: {
                expected: { enabled: false, events: [] },
                replacement: {
                    enabled: parsed.enabled,
                    events: parsed.events.map((event) => ({ ...event })),
                },
            },
        },
        remove: legacyStorage.remove,
    };
}
