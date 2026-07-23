/**
 * Collision-free stem filename derivation (audit finding OE-2).
 *
 * Two tracks that share a name — or that differ only in characters the filename
 * sanitizer strips, or only in letter case on a case-insensitive filesystem
 * (APFS, NTFS) — previously computed the same `${name}.${format}` and the second
 * stem silently overwrote the first (native directory write and web zip map alike).
 *
 * Disambiguation is keyed off the already-unique `track.id`, so the human-readable
 * track name still leads and a short id-derived suffix appears only to break a tie.
 * Collisions are detected case-insensitively so the emitted names are safe on
 * case-insensitive filesystems while preserving the author's original casing.
 *
 * The mapping is derived from the stable project-store track order, independent of
 * stem render-completion order, so `track → filename` is reproducible run to run.
 */

export type StemFileNameTrack = {
    id: string;
    name?: string | null;
};

export type DeriveStemFileBaseNamesInput = {
    /**
     * Track ids that have a rendered stem. Any order is accepted — render-completion
     * order from the concurrency pool does not affect the result.
     */
    stemTrackIds: Iterable<string>;
    /**
     * All project tracks in stable store order. Supplies display names and, crucially,
     * the deterministic order in which same-named tracks are disambiguated.
     */
    orderedTracks: readonly StemFileNameTrack[];
};

const FILESYSTEM_HOSTILE = /[^a-zA-Z0-9_\- ]/g;
const SHORT_ID_LENGTH = 8;

function sanitizeSegment(value: string): string {
    return value.replaceAll(FILESYSTEM_HOSTILE, '_');
}

/**
 * Map each track id to a collision-free, filesystem-safe base filename (no
 * extension). The first track (in stable store order) to claim a name keeps the
 * clean name; later collisions gain a suffix derived from their unique track id.
 */
export function deriveStemFileBaseNames(input: DeriveStemFileBaseNamesInput): Map<string, string> {
    const { stemTrackIds, orderedTracks } = input;
    const stemIdSet = new Set(stemTrackIds);
    const nameByTrackId = new Map(orderedTracks.map((track) => [track.id, track.name ?? '']));

    // Deterministic processing order: stable store order first, then any stem ids
    // not present in the store (an edge case) sorted by id string for reproducibility.
    const orderedStemIds: string[] = [];
    const seen = new Set<string>();
    for (const track of orderedTracks) {
        if (stemIdSet.has(track.id) && !seen.has(track.id)) {
            orderedStemIds.push(track.id);
            seen.add(track.id);
        }
    }
    const orphanIds = [...stemIdSet].filter((id) => !seen.has(id)).sort();
    orderedStemIds.push(...orphanIds);

    const baseNamesByTrackId = new Map<string, string>();
    // Fold to lower case for collision detection so case-only differences still collide
    // on case-insensitive filesystems, while the emitted name keeps its original casing.
    const usedFoldedNames = new Set<string>();

    for (const trackId of orderedStemIds) {
        const trimmedName = (nameByTrackId.get(trackId) ?? '').trim();
        const rawBase = trimmedName.length > 0 ? trimmedName : trackId;
        const base = sanitizeSegment(rawBase);

        let candidate = base;
        if (usedFoldedNames.has(candidate.toLowerCase())) {
            const shortId = sanitizeSegment(trackId).slice(0, SHORT_ID_LENGTH) || trackId;
            candidate = `${base}_${shortId}`;

            let counter = 2;
            while (usedFoldedNames.has(candidate.toLowerCase())) {
                candidate = `${base}_${shortId}_${counter}`;
                counter++;
            }
        }

        usedFoldedNames.add(candidate.toLowerCase());
        baseNamesByTrackId.set(trackId, candidate);
    }

    return baseNamesByTrackId;
}
