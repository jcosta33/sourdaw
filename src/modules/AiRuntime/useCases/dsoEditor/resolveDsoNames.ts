/**
 * Resolve human-readable DSO references to the current DAW store IDs.
 */
import { trackStore } from '#/modules/Arrangement/stores';

import { type Dso } from '../../models/DsoTypes';

type DsoValidationError = {
    dso: Dso;
    reason: string;
};

// ── Fuzzy name matching ──────────────────────────────────────────────────────

/**
 * Score how well `query` matches `candidate` (0 = no match, higher = better).
 * Handles typos, partial matches, and case differences.
 */
function fuzzyScore(query: string, candidate: string): number {
    const query1 = query.toLowerCase();
    const context = candidate.toLowerCase();

    // Exact match
    if (query1 === context) {
        return 100;
    }

    // Candidate contains query as substring
    if (context.includes(query1)) {
        return 80;
    }

    // Query contains candidate
    if (query1.includes(context)) {
        return 70;
    }

    // Token overlap (handles "drum bus" matching "Drum Bus Send")
    const qTokens = query1.split(/[\s_-]+/);
    const cTokens = context.split(/[\s_-]+/);
    let tokenHits = 0;
    for (const qt of qTokens) {
        if (qt.length < 2) {
            continue;
        }
        if (cTokens.some((ct) => ct.includes(qt) || qt.includes(ct))) {
            tokenHits++;
        }
    }
    if (tokenHits > 0) {
        return 40 + (tokenHits / Math.max(qTokens.length, 1)) * 30;
    }

    // Levenshtein-based typo tolerance (only for short strings to avoid expense)
    if (query1.length <= 15 && context.length <= 20) {
        const dist = levenshtein(query1, context);
        const maxLen = Math.max(query1.length, context.length);
        const similarity = 1 - dist / maxLen;
        if (similarity > 0.6) {
            return similarity * 50;
        }
    }

    return 0;
}

function levenshtein(alpha: string, b: string): number {
    const message = alpha.length;
    const node = b.length;
    const dp: number[][] = Array.from({ length: message + 1 }, (_, index) =>
        Array.from({ length: node + 1 }, (_, jIndex) => {
            if (index === 0) {
                return jIndex;
            }
            if (jIndex === 0) {
                return index;
            }
            return 0;
        })
    );
    for (let index = 1; index <= message; index++) {
        for (let jIndex = 1; jIndex <= node; jIndex++) {
            dp[index]![jIndex] =
                alpha[index - 1] === b[jIndex - 1]
                    ? dp[index - 1]![jIndex - 1]!
                    : 1 + Math.min(dp[index - 1]![jIndex]!, dp[index]![jIndex - 1]!, dp[index - 1]![jIndex - 1]!);
        }
    }
    return dp[message]![node]!;
}

function bestMatch<TItem>(
    query: string,
    items: TItem[],
    getName: (item: TItem) => string,
    threshold = 30
): TItem | null {
    let best: TItem | null = null;
    let bestScore = 0;
    for (const item of items) {
        const score = fuzzyScore(query, getName(item));
        if (score > bestScore && score >= threshold) {
            best = item;
            bestScore = score;
        }
    }
    return best;
}

/**
 * Track-targeting ops for which an unresolved `track_id` may be auto-created.
 * These materialize new content on a target track, so the LLM naming a track
 * that does not exist yet is a legitimate "create it" intent. Every other
 * track-targeting op (remove_track, rename_track, mute_track, solo_track,
 * arm_track, color_track, reorder_track, remove_device) references an existing
 * track — a miss there is a resolution error, never a silent create.
 */
const ADDITIVE_TRACK_OPS: ReadonlySet<Dso['op']> = new Set<Dso['op']>([
    'add_clip',
    'insert_device',
    'generate_melody',
    'generate_chords',
    'generate_drums',
]);

/**
 * Resolve name-based references in DSOs to actual store IDs.
 * Uses fuzzy matching to handle typos and partial names.
 * Mutates the DSO objects in-place.
 * Returns unresolved names as errors.
 */
export function resolveDsoNames(dsos: Dso[]): DsoValidationError[] {
    const state = trackStore.value;
    if (!state) {
        return [];
    }

    const errors: DsoValidationError[] = [];
    const allClips = state.tracks.flatMap((time) => time.clips);
    const allDevices = state.tracks.flatMap((time) => time.devices);

    // Keep track of dynamically created tracks during this resolve pass
    const mockTracks: { id: string; name: string }[] = [];

    function findTrackId(nameOrId: string): string | null {
        if (state!.tracks.some((time) => time.id === nameOrId)) {
            return nameOrId;
        }
        if (mockTracks.some((time) => time.id === nameOrId)) {
            return nameOrId;
        }

        let match: { id: string } | null = bestMatch(nameOrId, state!.tracks, (time) => time.name);
        if (!match) {
            match = bestMatch(nameOrId, mockTracks, (time) => time.name);
        }
        return match?.id ?? null;
    }

    function findClipId(nameOrId: string): string | null {
        if (allClips.some((context) => context.id === nameOrId)) {
            return nameOrId;
        }
        const match = bestMatch(nameOrId, allClips, (context) => context.name);
        return match?.id ?? null;
    }

    function findDeviceId(nameOrId: string): string | null {
        if (nameOrId === 'latest') {
            return 'latest';
        }
        if (allDevices.some((data) => data.id === nameOrId)) {
            return nameOrId;
        }
        const match = bestMatch(nameOrId, allDevices, (data) => data.type);
        return match?.id ?? null;
    }

    let index = 0;
    while (index < dsos.length) {
        const dso = dsos[index]!;

        // Resolve track_id fields
        if ('track_id' in dso && typeof dso.track_id === 'string') {
            const resolved = findTrackId(dso.track_id);
            if (resolved) {
                (dso as Record<string, unknown>).track_id = resolved;
            } else if (!['add_track'].includes(dso.op)) {
                // Check if the LLM meant the selected track
                const selectedTrackId = state.selectedTrackId;
                const selectedTrack = selectedTrackId ? state.tracks.find((time) => time.id === selectedTrackId) : null;
                const lowerName = dso.track_id.toLowerCase();
                const isSelectedRef =
                    lowerName.includes('selected') || lowerName.includes('current') || lowerName.includes('this');

                if (isSelectedRef && selectedTrack) {
                    // Resolve to the actually selected track
                    (dso as Record<string, unknown>).track_id = selectedTrack.id;
                } else if (ADDITIVE_TRACK_OPS.has(dso.op)) {
                    // Fallback: auto-create this track — only for additive ops that
                    // legitimately materialize content on a (possibly new) target
                    // track. A miss on a non-additive op (remove_*/mute_*/etc.)
                    // must NOT silently create the track it was meant to address.
                    const newId = `track-${crypto.randomUUID().slice(0, 8)}`;
                    const kindFallback =
                        dso.op === 'generate_drums' || lowerName.includes('drum') || lowerName.includes('midi')
                            ? 'midi'
                            : 'audio';

                    dsos.splice(index, 0, {
                        op: 'add_track',
                        name: dso.track_id,
                        kind: kindFallback,
                        track_id: newId,
                    } as Dso);

                    mockTracks.push({ id: newId, name: dso.track_id });
                    (dso as Record<string, unknown>).track_id = newId;
                    index++;
                } else {
                    // Non-additive op referencing a track that does not exist:
                    // surface a resolution error instead of fabricating a track.
                    errors.push({ dso, reason: `Could not find track "${dso.track_id}"` });
                }
            }
        }

        // Resolve destination_track_id
        if ('destination_track_id' in dso && typeof dso.destination_track_id === 'string') {
            const resolved = findTrackId(dso.destination_track_id);
            if (resolved) {
                (dso as Record<string, unknown>).destination_track_id = resolved;
            } else {
                errors.push({ dso, reason: `Could not find destination track "${dso.destination_track_id}"` });
            }
        }

        // Resolve from_track_id / to_track_id
        if ('from_track_id' in dso && typeof dso.from_track_id === 'string') {
            const resolved = findTrackId(dso.from_track_id);
            if (resolved) {
                (dso as Record<string, unknown>).from_track_id = resolved;
            } else {
                errors.push({ dso, reason: `Could not find source track "${dso.from_track_id}"` });
            }
        }
        if ('to_track_id' in dso && typeof dso.to_track_id === 'string') {
            const resolved = findTrackId(dso.to_track_id);
            if (resolved) {
                (dso as Record<string, unknown>).to_track_id = resolved;
            } else {
                errors.push({ dso, reason: `Could not find target track "${dso.to_track_id}"` });
            }
        }

        // Resolve clip_id fields
        if ('clip_id' in dso && typeof dso.clip_id === 'string') {
            const resolved = findClipId(dso.clip_id);
            if (resolved) {
                (dso as Record<string, unknown>).clip_id = resolved;
            } else {
                errors.push({ dso, reason: `Could not find clip "${dso.clip_id}"` });
            }
        }

        // Resolve device_id fields
        if ('device_id' in dso && typeof dso.device_id === 'string') {
            const resolved = findDeviceId(dso.device_id);
            if (resolved) {
                (dso as Record<string, unknown>).device_id = resolved;
            } else {
                errors.push({ dso, reason: `Could not find device "${dso.device_id}"` });
            }
        }

        index++;
    }

    return errors;
}
