import { describe, it, expect } from 'vitest';
import { getScalePitches, snapToScale, chordFromDegrees, filterTemplates } from '../scaleTheory';
import { type PatternTemplate } from '../../models/MidiPatternType';

describe('scaleTheory', () => {
    describe('getScalePitches', () => {
        it('returns C Major scale correctly', () => {
            const cMajor = getScalePitches('C', 'major', 60, 72);
            // C4 to C5: C, D, E, F, G, A, B, C
            expect(cMajor).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
        });

        it('returns A Minor scale correctly', () => {
            const aMinor = getScalePitches('A', 'minor', 69, 81);
            // A4 to A5: A, B, C, D, E, F, G, A
            expect(aMinor).toEqual([69, 71, 72, 74, 76, 77, 79, 81]);
        });
        
        it('handles boundary ranges', () => {
            const pitches = getScalePitches('C', 'major', 60, 60);
            expect(pitches).toEqual([60]);
        });
    });

    describe('snapToScale', () => {
        it('snaps pitch to exact scale tone', () => {
            const scale = [60, 62, 64, 65, 67];
            expect(snapToScale(64, scale)).toBe(64);
        });

        it('snaps pitch to nearest scale tone', () => {
            const scale = [60, 62, 64, 65, 67];
            expect(snapToScale(61, scale)).toBe(60); // Nearest could be 60 or 62, either is valid, test logic resolves to first encountered usually or math absolute
            expect(snapToScale(63, scale)).toBe(62); // Nearest is 62 (encountered first) or 64
            expect(snapToScale(66, scale)).toBe(65); // Nearest is 65
        });
    });

    describe('chordFromDegrees', () => {
        it('builds a chord from scale degrees', () => {
            const scale = [60, 62, 64, 65, 67, 69, 71, 72];
            // C Major Triad (I): degrees 0, 2, 4 (C, E, G)
            const notes = chordFromDegrees([0, 2, 4], scale, 0, 1, 2, 90);
            
            expect(notes).toHaveLength(3);
            expect(notes[0]).toEqual({ pitch: 60, velocity: 90, startBeat: 1, durationBeats: 2 });
            expect(notes[1]).toEqual({ pitch: 64, velocity: 90, startBeat: 1, durationBeats: 2 });
            expect(notes[2]).toEqual({ pitch: 67, velocity: 90, startBeat: 1, durationBeats: 2 });
        });

        it('clamps degrees out of range to scale bounds', () => {
            const scale = [60, 62, 64];
            const notes = chordFromDegrees([5], scale, 0, 0, 1, 80);
            expect(notes[0]!.pitch).toBe(64); // Clamped to the highest available pitch
        });
    });

    describe('filterTemplates', () => {
        const templates: PatternTemplate[] = [
            {
                name: 'Pop Beat',
                description: 'A standard pop drum beat',
                category: 'drum',
                tags: ['4/4', 'basic'],
                genres: ['pop', 'rock'],
                resolution: 16,
                generate: () => [],
            },
            {
                name: 'Jazz Ride',
                description: 'Swing pattern',
                category: 'drum',
                tags: ['swing', 'triplet'],
                genres: ['jazz'],
                resolution: 12,
                generate: () => [],
            },
            {
                name: 'Ambient Pad',
                description: 'Long chords',
                category: 'chord',
                tags: ['pad', 'slow'],
                genres: ['ambient', 'electronic'],
                resolution: 4,
                generate: () => [],
            }
        ];

        it('filters by category', () => {
            const filtered = filterTemplates(templates, { category: 'chord' });
            expect(filtered).toHaveLength(1);
            expect(filtered[0]!.name).toBe('Ambient Pad');
        });

        it('filters by genre', () => {
            const filtered = filterTemplates(templates, { genres: ['jazz'] });
            expect(filtered).toHaveLength(1);
            expect(filtered[0]!.name).toBe('Jazz Ride');
        });

        it('filters by tags', () => {
            const filtered = filterTemplates(templates, { tags: ['basic'] });
            expect(filtered).toHaveLength(1);
            expect(filtered[0]!.name).toBe('Pop Beat');
        });

        it('filters by text query across multiple fields', () => {
            const filtered1 = filterTemplates(templates, { query: 'swing pattern' });
            expect(filtered1).toHaveLength(1);
            expect(filtered1[0]!.name).toBe('Jazz Ride');

            const filtered2 = filterTemplates(templates, { query: 'pop' });
            expect(filtered2).toHaveLength(1);
            expect(filtered2[0]!.name).toBe('Pop Beat');
        });
        
        it('returns all when no filters apply', () => {
            const filtered = filterTemplates(templates, {});
            expect(filtered).toHaveLength(3);
        });
    });
});
