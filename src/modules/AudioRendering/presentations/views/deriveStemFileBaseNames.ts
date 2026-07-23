/**
 * Collision-free stem filename derivation (audit finding OE-2).
 *
 * Two tracks that share a name — or that differ only in characters the filename
 * sanitizer strips — previously computed the same `${name}.${format}` and the
 * second stem silently overwrote the first (native directory write and web zip
 * map alike). This keys disambiguation off the already-unique `track.id`, so the
 * human-readable track name still leads and a short id-derived suffix only appears
 * when it is needed to break a tie.
 */

export type StemFileNameSource = {
    trackId: string;
    name?: string | null;
};

const FILESYSTEM_HOSTILE = /[^a-zA-Z0-9_\- ]/g;
const SHORT_ID_LENGTH = 8;

function sanitizeSegment(value: string): string {
    return value.replaceAll(FILESYSTEM_HOSTILE, '_');
}

/**
 * Map each track id to a collision-free, filesystem-safe base filename (no
 * extension). Order is preserved: the first occurrence of a name keeps the clean
 * name; later collisions gain a suffix derived from their unique track id.
 */
export function deriveStemFileBaseNames(sources: readonly StemFileNameSource[]): Map<string, string> {
    const baseNamesByTrackId = new Map<string, string>();
    const usedNames = new Set<string>();

    for (const { trackId, name } of sources) {
        const trimmedName = (name ?? '').trim();
        const rawBase = trimmedName.length > 0 ? trimmedName : trackId;
        const base = sanitizeSegment(rawBase);

        let candidate = base;
        if (usedNames.has(candidate)) {
            const shortId = sanitizeSegment(trackId).slice(0, SHORT_ID_LENGTH) || trackId;
            candidate = `${base}_${shortId}`;

            let counter = 2;
            while (usedNames.has(candidate)) {
                candidate = `${base}_${shortId}_${counter}`;
                counter++;
            }
        }

        usedNames.add(candidate);
        baseNamesByTrackId.set(trackId, candidate);
    }

    return baseNamesByTrackId;
}
