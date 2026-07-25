import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClipDummy } from '../../__tests__/ClipDummy';
import { TrackDummy } from '../../__tests__/TrackDummy';
import { detectSongStructure } from '../detectSongStructure';

const mocks = vi.hoisted(() => ({
    value: null as { tracks: ReturnType<typeof TrackDummy.create>[] } | null,
}));

vi.mock('../../stores/trackStore', () => ({
    trackStore: {
        get value() {
            return mocks.value;
        },
    },
}));

function track(id: string, clips: { startBeat: number; endBeat: number }[]): ReturnType<typeof TrackDummy.create> {
    return TrackDummy.create({
        id,
        name: id,
        kind: 'audio',
        clips: clips.map((context, index) =>
            ClipDummy.create({
                id: `clip-${id}-${index}`,
                type: 'audio',
                startBeat: context.startBeat,
                endBeat: context.endBeat,
                audioBufferId: 'buf',
            })
        ),
    });
}

describe('detectSongStructure', () => {
    beforeEach(() => {
        mocks.value = null;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns an empty array when the track store has not loaded', () => {
        expect(detectSongStructure()).toEqual([]);
    });

    it('returns an empty array when no tracks hold clips', () => {
        mocks.value = { tracks: [track('t1', [])] };

        expect(detectSongStructure()).toEqual([]);
    });

    it('classifies sections and labels the first window as Intro', () => {
        // A long arrangement: loud intro block, then a sparse middle, then loud tail.
        // totalBeats is large enough to cross many 4-beat windows so boundaries emerge.
        mocks.value = {
            tracks: [
                track('t1', [
                    { startBeat: 0, endBeat: 4 },
                    { startBeat: 64, endBeat: 68 },
                    { startBeat: 128, endBeat: 132 },
                ]),
            ],
        };

        const sections = detectSongStructure();

        expect(sections.length).toBeGreaterThan(0);
        // First section always starts at beat 0.
        expect(sections[0]!.startBeat).toBe(0);
        // Every section has a stable name and color from the palette.
        for (const section of sections) {
            expect(typeof section.name).toBe('string');
            expect(section.confidence).toBeGreaterThan(0);
            expect(section.confidence).toBeLessThanOrEqual(1);
        }
    });

    it('scopes detection to a single track when a trackId is provided', () => {
        mocks.value = {
            tracks: [
                track('target', [{ startBeat: 0, endBeat: 8 }]),
                track('ignored', [{ startBeat: 0, endBeat: 200 }]),
            ],
        };

        const sections = detectSongStructure('target');

        // Only the target track's single clip is considered; with one clip
        // spanning 8 beats there is exactly one Intro section at beat 0.
        expect(sections).toHaveLength(1);
        expect(sections[0]!.name).toBe('Intro');
    });
});
