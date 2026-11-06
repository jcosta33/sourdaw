import { describe, expect, it } from 'vitest';

import { type PlayheadFollowScrollInput, resolvePlayheadFollowScroll } from '../resolvePlayheadFollowScroll';

// 10 px per beat, 800 px viewport, scrolled to 5000..5800 px unless a row says otherwise.
const base: PlayheadFollowScrollInput = {
    previousPlayheadBeat: 520,
    playheadBeat: 520,
    isPlaying: false,
    autoScrollEnabled: true,
    scrollX: 5000,
    viewportWidth: 800,
    pixelsPerBeat: 10,
};

describe('resolvePlayheadFollowScroll', () => {
    it.each([
        {
            name: 'stopped jump out of view to the left scrolls',
            input: { playheadBeat: 0 },
            expected: -200,
        },
        {
            name: 'stopped jump out of view to the right scrolls',
            input: { previousPlayheadBeat: 0, playheadBeat: 1000 },
            expected: 9800,
        },
        {
            name: 'stopped jump inside the view returns null',
            input: { playheadBeat: 540 },
            expected: null,
        },
        {
            name: 'stopped jump onto the left edge returns null',
            input: { playheadBeat: 500 },
            expected: null,
        },
        {
            name: 'stopped jump onto the right edge (exclusive) scrolls',
            input: { playheadBeat: 580 },
            expected: 5600,
        },
        {
            name: 'stopped with no position change while out of view returns null',
            input: { previousPlayheadBeat: 0, playheadBeat: 0 },
            expected: null,
        },
        {
            name: 'stopped jump with autoScrollEnabled false still scrolls',
            input: { playheadBeat: 0, autoScrollEnabled: false },
            expected: -200,
        },
        {
            name: 'playing past the 75% threshold scrolls',
            input: { isPlaying: true, previousPlayheadBeat: 550, playheadBeat: 570 },
            expected: 5500,
        },
        {
            name: 'playing left of the view scrolls',
            input: { isPlaying: true, playheadBeat: 400 },
            expected: 3800,
        },
        {
            name: 'playing inside the view returns null',
            input: { isPlaying: true, playheadBeat: 540 },
            expected: null,
        },
        {
            name: 'playing with follow off returns null',
            input: { isPlaying: true, autoScrollEnabled: false, playheadBeat: 900 },
            expected: null,
        },
    ])('$name', ({ input, expected }) => {
        expect(resolvePlayheadFollowScroll({ ...base, ...input })).toBe(expected);
    });
});
