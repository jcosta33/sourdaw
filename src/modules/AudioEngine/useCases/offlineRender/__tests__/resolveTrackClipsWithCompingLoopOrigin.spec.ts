import { afterEach, describe, expect, it } from 'vitest';

import { type Clip, takeLaneStore } from '#/modules/Arrangement/stores';
import { resolveClipsWithComping } from '#/modules/Arrangement/useCases';

import { getSourceOccurrenceOffset } from '../getSourceOccurrenceOffset';
import { resolveTrackClipsWithComping } from '../resolveTrackClipsWithComping';

/**
 * #4988, second consequence: the probability pass identity must survive a
 * start trim. `getSourceOccurrenceOffset` seeds each loop pass with
 * `floor((segment − sourceStartBeat) / loopLength)`, so the resolvers must
 * stamp `sourceStartBeat` with the clip's loop anchor, not its current
 * placement — otherwise every trim restarts the count at zero and different
 * passes sound after the trim than before it.
 *
 * The issue's example: clip 0–16 with a 4-beat loop, trimmed to start at 4.
 * With seed 1 the passes roll false/true/false/false for occurrence indices
 * 0–3, so only the pass at 4–8 sounds — before and after the trim alike. The
 * offset arithmetic below is the producing line for that observable, shared by
 * the offline renderer, the native export and the live scheduler.
 */

function loopedClip(overrides: Partial<Clip> & Pick<Clip, 'id'>): Clip {
    return {
        trackId: 't-keys',
        name: 'c',
        startBeat: 4,
        endBeat: 16,
        type: 'midi',
        loopEnabled: true,
        loopLength: 4,
        loopOriginBeat: 0,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
        ...overrides,
    };
}

function occurrenceIndexAt(resolved: { sourceStartBeat: number; startBeat: number }): number {
    return getSourceOccurrenceOffset({
        sourceStartBeat: resolved.sourceStartBeat,
        segmentStartBeat: resolved.startBeat,
        loopLength: 4,
        loopEnabled: true,
    });
}

describe('occurrence anchoring across the two comping resolvers', () => {
    afterEach(() => {
        takeLaneStore.set({ lanes: [] });
    });

    it('the offline resolver stamps the loop anchor so a trimmed clip keeps its pass identities', () => {
        takeLaneStore.set({ lanes: [] });

        const [resolved] = resolveTrackClipsWithComping('t-keys', [loopedClip({ id: 'c' })]);

        expect(resolved!.sourceStartBeat).toBe(0);
        // The pass at 4–8 is the second pass of the source's loop, not the
        // first: occurrence index 1, the same roll it had before the trim.
        expect(occurrenceIndexAt(resolved!)).toBe(1);
    });

    it('the live resolver stamps the loop anchor the same way', () => {
        takeLaneStore.set({ lanes: [] });

        const [resolved] = resolveClipsWithComping('t-keys', [loopedClip({ id: 'c' })]);

        expect(resolved!.sourceStartBeat).toBe(0);
        expect(occurrenceIndexAt(resolved!)).toBe(1);
    });

    it('a clip without an anchor stamps its current placement, exactly the pre-anchor reading', () => {
        takeLaneStore.set({ lanes: [] });

        const offlineResolved = resolveTrackClipsWithComping('t-keys', [
            loopedClip({ id: 'c', loopOriginBeat: undefined }),
        ]);
        const liveResolved = resolveClipsWithComping('t-keys', [loopedClip({ id: 'c', loopOriginBeat: undefined })]);

        expect(offlineResolved[0]!.sourceStartBeat).toBe(4);
        expect(offlineResolved[0]!.id).toBe('c');
        expect(occurrenceIndexAt(offlineResolved[0]!)).toBe(0);
        expect(liveResolved[0]!.sourceStartBeat).toBe(4);
        expect(occurrenceIndexAt(liveResolved[0]!)).toBe(0);
    });
});
