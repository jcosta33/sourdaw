import { describe, it, expect } from 'vitest';

import {
    beatToSamples,
    createTempoChange,
    getTempoAtBeat,
    samplesToBeat,
    splitRangeAtTempoChanges,
    type TempoChange,
} from '../TempoMap';

describe('createTempoChange', () => {
    it('should clamp tempo into the supported range', () => {
        expect(createTempoChange(0, 10).tempo).toBe(20);
        expect(createTempoChange(0, 2000).tempo).toBe(999);
    });
});

describe('getTempoAtBeat', () => {
    it('should return the default when there are no changes', () => {
        expect(getTempoAtBeat([], 4, 120)).toBe(120);
    });

    it('should use the first change tempo when beat is before all changes', () => {
        const changes: TempoChange[] = [
            { id: 'a', beat: 4, tempo: 140, curve: 'instant' },
            { id: 'b', beat: 8, tempo: 160, curve: 'instant' },
        ];
        expect(getTempoAtBeat(changes, 2, 120)).toBe(140);
    });

    it('should use the last change tempo when beat is after all changes', () => {
        const changes: TempoChange[] = [
            { id: 'a', beat: 0, tempo: 100, curve: 'instant' },
            { id: 'b', beat: 4, tempo: 200, curve: 'instant' },
        ];
        expect(getTempoAtBeat(changes, 99, 120)).toBe(200);
    });

    it('should interpolate when the active segment uses a linear curve', () => {
        const changes: TempoChange[] = [
            { id: 'a', beat: 0, tempo: 100, curve: 'linear' },
            { id: 'b', beat: 10, tempo: 200, curve: 'instant' },
        ];
        expect(getTempoAtBeat(changes, 5, 120)).toBe(150);
    });

    it('should hold the previous tempo for instant curves until the next point', () => {
        const changes: TempoChange[] = [
            { id: 'a', beat: 0, tempo: 100, curve: 'instant' },
            { id: 'b', beat: 10, tempo: 200, curve: 'instant' },
        ];
        expect(getTempoAtBeat(changes, 9, 120)).toBe(100);
    });
});

describe('integrated tempo-map coordinates', () => {
    const changes: TempoChange[] = [
        { id: 'a', beat: 0, tempo: 120, curve: 'instant' },
        { id: 'b', beat: 4, tempo: 240, curve: 'instant' },
        { id: 'c', beat: 6, tempo: 60, curve: 'instant' },
    ];

    it('keeps one monotonic sample timeline across multiple tempo changes', () => {
        expect(beatToSamples(changes, 3, 120, 48000)).toBe(72000);
        expect(beatToSamples(changes, 4, 120, 48000)).toBe(96000);
        expect(beatToSamples(changes, 5, 120, 48000)).toBe(108000);
        expect(beatToSamples(changes, 6, 120, 48000)).toBe(120000);
        expect(beatToSamples(changes, 7, 120, 48000)).toBe(168000);
    });

    it('inverts exact tempo-boundary samples without changing boundary ownership', () => {
        expect(samplesToBeat(changes, 96000, 120, 48000)).toBe(4);
        expect(samplesToBeat(changes, 120000, 120, 48000)).toBe(6);
        expect(samplesToBeat(changes, 168000, 120, 48000)).toBe(7);
    });

    it('splits only at interior tempo changes and never creates zero-length boundary blocks', () => {
        expect(splitRangeAtTempoChanges(changes, 3, 7)).toEqual([
            { fromBeat: 3, toBeat: 4 },
            { fromBeat: 4, toBeat: 6 },
            { fromBeat: 6, toBeat: 7 },
        ]);
        expect(splitRangeAtTempoChanges(changes, 4, 6)).toEqual([{ fromBeat: 4, toBeat: 6 }]);
    });
});
