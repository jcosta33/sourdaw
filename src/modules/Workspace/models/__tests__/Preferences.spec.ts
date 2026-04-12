import { describe, expect, it } from 'vitest';

import {
    BUFFER_SIZE_OPTIONS,
    GRID_SNAP_OPTIONS,
    SAMPLE_RATE_OPTIONS,
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
        expect(gridSnapBeats('1/4T')).toBeCloseTo(1 / 3);
        expect(gridSnapBeats('1/8D')).toBeCloseTo(0.1875);
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
        expect(GRID_SNAP_OPTIONS.every((o) => typeof o.beats === 'number')).toBe(true);
    });

    it('should list buffer sizes in ascending order', () => {
        expect(BUFFER_SIZE_OPTIONS.map((o) => o.value)).toEqual([128, 256, 512, 1024, 2048]);
    });

    it('should list common sample rates', () => {
        expect(SAMPLE_RATE_OPTIONS.map((o) => o.value)).toEqual([44100, 48000, 96000]);
    });
});

describe('defaultPreferences', () => {
    it('should use normal track height and default buffer settings', () => {
        expect(defaultPreferences.trackHeight).toBe('normal');
        expect(defaultPreferences.bufferSize).toBe(512);
        expect(defaultPreferences.sampleRate).toBe(44100);
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
