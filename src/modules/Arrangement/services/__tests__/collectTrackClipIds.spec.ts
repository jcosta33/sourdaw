import { describe, it, expect } from 'vitest';

import { type Clip } from '../../models/Track';
import { collectTrackClipIds } from '../collectTrackClipIds';

function clip(id: string): Clip {
    return {
        id,
        trackId: 't1',
        name: id,
        startBeat: 0,
        endBeat: 4,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#000000',
        locked: false,
        muted: false,
    };
}

describe('collectTrackClipIds', () => {
    it('collects ids from the primary clips array', () => {
        const ids = collectTrackClipIds({ clips: [clip('c1'), clip('c2')] });
        expect(ids).toEqual(['c1', 'c2']);
    });

    it('deduplicates clip ids across primary and alternative clips', () => {
        const ids = collectTrackClipIds({
            clips: [clip('c1'), clip('c2')],
            alternatives: [{ clips: [clip('c1'), clip('c3')] }],
        });
        expect(ids).toEqual(['c1', 'c2', 'c3']);
    });

    it('preserves insertion order: primary clips first, then alternatives', () => {
        const ids = collectTrackClipIds({
            clips: [clip('p1'), clip('p2')],
            alternatives: [{ clips: [clip('a1'), clip('a2')] }],
        });
        // Primary clips in array order, then alternative clips in iteration order.
        expect(ids).toEqual(['p1', 'p2', 'a1', 'a2']);
    });

    it('returns only primary ids when alternatives is not an array', () => {
        const ids = collectTrackClipIds({ clips: [clip('c1')], alternatives: undefined });
        expect(ids).toEqual(['c1']);
    });

    it('returns only primary ids when alternatives is null', () => {
        const ids = collectTrackClipIds({ clips: [clip('c1')], alternatives: null });
        expect(ids).toEqual(['c1']);
    });

    it('skips alternative entries that are not objects with a clips array', () => {
        const ids = collectTrackClipIds({
            clips: [clip('c1')],
            alternatives: ['garbage', null, { noClips: true }, { clips: 'not-an-array' }, { clips: [clip('c2')] }],
        });
        // Only c1 (primary) and c2 (valid alternative) survive, in that order.
        expect(ids).toEqual(['c1', 'c2']);
    });

    it('skips alternative clips without a string id', () => {
        const ids = collectTrackClipIds({
            clips: [clip('c1')],
            alternatives: [{ clips: [{ id: 123 }, { noId: true }, clip('c2')] }],
        });
        expect(ids).toEqual(['c1', 'c2']);
    });

    it('handles an empty clips array with no alternatives', () => {
        expect(collectTrackClipIds({ clips: [] })).toEqual([]);
    });

    it('handles an empty clips array with alternatives', () => {
        const ids = collectTrackClipIds({ clips: [], alternatives: [{ clips: [clip('c1')] }] });
        expect(ids).toEqual(['c1']);
    });

    it('deduplicates ids repeated within a single alternative', () => {
        const ids = collectTrackClipIds({
            clips: [],
            alternatives: [{ clips: [clip('c1'), clip('c1')] }],
        });
        expect(ids).toEqual(['c1']);
    });
});
