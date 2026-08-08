import { describe, expect, it } from 'vitest';

import {
    AUDIO_LATENCY_PROFILE_OPTIONS,
    GRID_SNAP_OPTIONS,
    TRACK_HEIGHT_VALUES,
    defaultPreferences,
    gridSnapBeats,
} from '../Preferences';

describe('gridSnapBeats', () => {
    it('should map bar, sixteenth, and off', () => {
        expect(gridSnapBeats('bar')).toBe(4);
        expect(gridSnapBeats('1/16')).toBe(0.0625);
        expect(gridSnapBeats('off')).toBe(0);
    });

    it('should map triplet options', () => {
        expect(gridSnapBeats('1/4T')).toBeCloseTo(1 / 6);
        expect(gridSnapBeats('1/8D')).toBeCloseTo(0.1875);
    });

    it('keeps every triplet option at two thirds of its straight sibling', () => {
        const beatsFor = (value: Parameters<typeof gridSnapBeats>[0]): number => {
            const entry = GRID_SNAP_OPTIONS.find((option) => option.value === value);
            expect(entry).toBeDefined();
            return entry!.beats;
        };

        expect(beatsFor('1/4T')).toBeCloseTo((2 / 3) * beatsFor('1/4'));
        expect(beatsFor('1/8T')).toBeCloseTo((2 / 3) * beatsFor('1/8'));
        expect(beatsFor('1/16T')).toBeCloseTo((2 / 3) * beatsFor('1/16'));
    });

    it('should return 0 for an unknown option', () => {
        expect(gridSnapBeats('not-a-grid' as Parameters<typeof gridSnapBeats>[0])).toBe(0);
    });

    it('should map beat and eighth-note subdivisions', () => {
        expect(gridSnapBeats('beat')).toBe(1);
        expect(gridSnapBeats('1/8')).toBe(0.125);
    });

    it('should map thirty-second notes', () => {
        expect(gridSnapBeats('1/32')).toBe(0.03125);
    });
});

describe('option lists', () => {
    it('should list every grid snap value with a beat length', () => {
        expect(GRID_SNAP_OPTIONS.length).toBe(13);
        expect(GRID_SNAP_OPTIONS.every((output) => typeof output.beats === 'number')).toBe(true);
    });

    it('should list the low-latency and high-capacity audio profiles', () => {
        expect(AUDIO_LATENCY_PROFILE_OPTIONS.map((output) => output.value)).toEqual(['lowLatency', 'highCapacity']);
    });
});

describe('defaultPreferences', () => {
    it('should use normal track height and the low-latency audio profile', () => {
        expect(defaultPreferences.trackHeight).toBe('normal');
        expect(defaultPreferences.audioLatencyProfile).toBe('lowLatency');
        expect(defaultPreferences.soloMode).toBe('sip');
    });

    it('should default grid snap and theme for new sessions', () => {
        expect(defaultPreferences.snapToGrid).toBe(true);
        expect(defaultPreferences.gridSubdivision).toBe('1/4');
        expect(defaultPreferences.theme).toBe('dark');
    });
});

describe('TRACK_HEIGHT_VALUES', () => {
    it('should map track height presets to pixel heights', () => {
        expect(TRACK_HEIGHT_VALUES.compact).toBe(40);
        expect(TRACK_HEIGHT_VALUES.normal).toBe(64);
        expect(TRACK_HEIGHT_VALUES.large).toBe(96);
    });
});
