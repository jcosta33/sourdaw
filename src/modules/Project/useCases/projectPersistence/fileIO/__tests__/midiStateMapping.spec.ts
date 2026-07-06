import { describe, it, expect } from 'vitest';

import { mapProjectMidiValues } from '../midiStateMapping';

describe('mapProjectMidiValues', () => {
    it('maps entries while passing entry index and clip id', () => {
        const mapped = mapProjectMidiValues({
            byClipId: {
                'clip-1': [10, 20],
                'clip-2': [30],
            },
            mapEntry: (entry, index, clipId) => `${clipId}:${index}:${entry}`,
        });

        expect(mapped).toEqual({
            'clip-1': ['clip-1:0:10', 'clip-1:1:20'],
            'clip-2': ['clip-2:0:30'],
        });
    });

    it('returns an empty map when input is absent', () => {
        const mapped = mapProjectMidiValues({
            byClipId: undefined,
            mapEntry: (entry: number) => entry,
        });

        expect(mapped).toEqual({});
    });
});
