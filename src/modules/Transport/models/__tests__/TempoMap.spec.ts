import { describe, it, expect } from 'vitest';

import { createTempoChange, getTempoAtBeat, type TempoChange } from '../TempoMap';

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
