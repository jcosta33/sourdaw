const LEGACY_CHORD_TRACK_STORAGE_KEY = 'sourdaw_chord_track';

export type LegacyChordTrackStorage = {
    raw: string;
    remove: () => void;
};

export function readLegacyChordTrackStorage(): LegacyChordTrackStorage | null {
    if (typeof window === 'undefined') {
        return null;
    }

    let raw: string | null;
    try {
        raw = window.localStorage.getItem(LEGACY_CHORD_TRACK_STORAGE_KEY);
    } catch {
        return null;
    }
    if (raw === null) {
        return null;
    }

    return {
        raw,
        remove: () => {
            try {
                window.localStorage.removeItem(LEGACY_CHORD_TRACK_STORAGE_KEY);
            } catch {
                // A blocked cleanup must not invalidate an already committed migration.
            }
        },
    };
}
