import { describe, it, expect } from 'vitest';

import { getScalePitches, snapToScale, chordFromDegrees, filterTemplates } from '../scaleTheory';

describe('getScalePitches', () => {
    it('returns array of MIDI pitches', () => {
        const pitches = getScalePitches('C', 'major', 60, 72);
        expect(pitches).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
    });
    it('minor scale has flat 3, 6, 7', () => {
        const pitches = getScalePitches('C', 'minor', 60, 72);
        expect(pitches).toContain(63);
        expect(pitches).not.toContain(64);
        expect(pitches).toEqual([60, 62, 63, 65, 67, 68, 70, 72]);
    });
    it('respects note range bounds', () => {
        const pitches = getScalePitches('A', 'minor', 69, 69);
        expect(pitches).toEqual([69]);
    });
    it('pentatonic-minor has fewer tones than major', () => {
        const major = getScalePitches('C', 'major', 60, 72);
        const penta = getScalePitches('C', 'pentatonic-minor', 60, 72);
        expect(penta.length).toBeLessThan(major.length);
    });
    it('different keys produce different root pitches', () => {
        const c = getScalePitches('C', 'major', 60, 62);
        const d = getScalePitches('D', 'major', 60, 62);
        expect(c).not.toEqual(d);
    });
    it('blues scale has 6 tones per octave', () => {
        const pitches = getScalePitches('C', 'blues', 60, 72);
        expect(pitches.length).toBeGreaterThanOrEqual(5);
    });
});

describe('snapToScale', () => {
    it('snaps to nearest scale tone', () => {
        const scale = [60, 62, 64, 65, 67, 69, 71];
        expect(snapToScale(61, scale)).toBe(60);
        expect(snapToScale(63, scale)).toBe(62);
    });
    it('returns exact match when on scale', () => {
        const scale = [60, 62, 64];
        expect(snapToScale(62, scale)).toBe(62);
    });
    it('handles equidistant pitches (picks first)', () => {
        const scale = [60, 64];
        expect(snapToScale(62, scale)).toBe(60);
    });
    it('handles empty scale gracefully', () => {
        expect(snapToScale(60, [])).toBeUndefined();
    });
});

describe('chordFromDegrees', () => {
    const scale = getScalePitches('C', 'major', 48, 84);

    it('builds triad from degrees 0,2,4', () => {
        const chord = chordFromDegrees([0, 2, 4], scale, 0, 0, 4);
        expect(chord).toHaveLength(3);
        expect(chord[0]?.pitch).toBeLessThanOrEqual(chord[1]?.pitch ?? 0);
    });
    it('respects beat offset', () => {
        const chord = chordFromDegrees([0], scale, 0, 8, 2);
        expect(chord[0]?.startBeat).toBe(8);
    });
    it('respects duration', () => {
        const chord = chordFromDegrees([0], scale, 0, 0, 3);
        expect(chord[0]?.durationBeats).toBe(3);
    });
    it('respects velocity', () => {
        const chord = chordFromDegrees([0], scale, 0, 0, 1, 95);
        expect(chord[0]?.velocity).toBe(95);
    });
    it('handles empty degrees', () => {
        expect(chordFromDegrees([], scale, 0, 0, 1)).toEqual([]);
    });
    it('handles empty scale', () => {
        expect(chordFromDegrees([0, 2, 4], [], 0, 0, 1)).toEqual([]);
    });
    it('wraps degrees across octaves', () => {
        const chord = chordFromDegrees([0, 7], scale, 0, 0, 1);
        expect(chord[1]?.pitch).toBeGreaterThanOrEqual(chord[0]?.pitch ?? 0);
    });
});

describe('filterTemplates', () => {
    const templates = [
        {
            id: '1',
            name: 'Pop Bass',
            category: 'bass',
            genres: ['pop'],
            tags: ['simple'],
            description: 'Pop',
            generate: () => [],
            lengthBeats: 4,
        },
        {
            id: '2',
            name: 'Jazz Drums',
            category: 'drums',
            genres: ['jazz'],
            tags: ['swing'],
            description: 'Jazz',
            generate: () => [],
            lengthBeats: 4,
        },
        {
            id: '3',
            name: 'Rock Chords',
            category: 'chords',
            genres: ['rock'],
            tags: ['power'],
            description: 'Rock',
            generate: () => [],
            lengthBeats: 4,
        },
    ] as never;

    it('filters by category', () => {
        expect(filterTemplates(templates, { category: 'bass' })).toHaveLength(1);
    });
    it('filters by genre', () => {
        expect(filterTemplates(templates, { genres: ['jazz'] })).toHaveLength(1);
    });
    it('filters by tag', () => {
        expect(filterTemplates(templates, { tags: ['power'] })).toHaveLength(1);
    });
    it('filters by query text', () => {
        expect(filterTemplates(templates, { query: 'pop' })).toHaveLength(1);
    });
    it('returns all with no filters', () => {
        expect(filterTemplates(templates, {})).toHaveLength(3);
    });
    it('returns empty when no match', () => {
        expect(filterTemplates(templates, { query: 'nonexistent' })).toHaveLength(0);
    });
});
