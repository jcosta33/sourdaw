import { describe, expect, it } from 'vitest';

import { defaultPreferences, TOOL_SHORTCUTS, TRACK_HEIGHT_VALUES } from '../helpers';

describe('workspaceQueries helpers', () => {
    it('maps track height presets to pixel heights', () => {
        expect(TRACK_HEIGHT_VALUES.compact).toBe(40);
        expect(TRACK_HEIGHT_VALUES.normal).toBe(64);
        expect(TRACK_HEIGHT_VALUES.large).toBe(96);
    });

    it('maps editing tool shortcuts', () => {
        expect(TOOL_SHORTCUTS.s).toBe('select');
        expect(TOOL_SHORTCUTS.c).toBe('cut');
        expect(TOOL_SHORTCUTS.d).toBe('draw');
        expect(TOOL_SHORTCUTS.b).toBe('draw');
        expect(TOOL_SHORTCUTS.t).toBe('stretch');
    });

    it('defaultPreferences has expected grid and audio defaults', () => {
        expect(defaultPreferences.snapToGrid).toBe(true);
        expect(defaultPreferences.gridSubdivision).toBe('1/4');
        expect(defaultPreferences.bufferSize).toBe(512);
        expect(defaultPreferences.sampleRate).toBe(44100);
    });
});
