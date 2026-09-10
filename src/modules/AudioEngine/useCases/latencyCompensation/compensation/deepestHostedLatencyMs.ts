import { trackStore } from '#/modules/Arrangement/stores';

import { getTrackLatency } from './getTrackLatency';

/**
 * How deep the native engine's own compensation already holds its mix, in
 * milliseconds (#4153).
 *
 * The engine runs a plugin delay compensation pass of its own
 * (`Timeline::compensate`, `crates/daw-engine/src/timeline.rs`): it holds every
 * route it carries back to the deepest figure any of its own devices declares,
 * on top of whatever delay the programme asked for. So a programme aimed at a
 * native strip has to know that figure to avoid asking for it twice, and the
 * figure is exactly what the engine-hosted exclusion removes — a strip's total
 * with its hosted devices counted, less the same total with them excluded,
 * maxed over every strip in the set.
 *
 * Buses belong in that maximum, because a native track's bus twin is the
 * engine's too: a Bacteria on a bus deepens every route passing through it.
 */
export function deepestHostedLatencyMs(engineHostedStripIds: ReadonlySet<string>): number {
    const state = trackStore.value;
    if (!state) {
        return 0;
    }

    let deepestMs = 0;
    for (const track of state.tracks) {
        if (!engineHostedStripIds.has(track.id)) {
            continue;
        }
        const counted = getTrackLatency(track.id).totalLatencyMs;
        const excluded = getTrackLatency(track.id, new Set(), undefined, engineHostedStripIds).totalLatencyMs;
        deepestMs = Math.max(deepestMs, counted - excluded);
    }

    return deepestMs;
}
