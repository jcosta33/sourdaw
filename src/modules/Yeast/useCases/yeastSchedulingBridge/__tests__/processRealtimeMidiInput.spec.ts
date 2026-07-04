import { describe, it, expect, beforeEach, vi } from 'vitest';

import { processRealtimeMidiInput } from '../processRealtimeMidiInput';
import { processYeastMidi } from '../processYeastMidi';

vi.mock('../processYeastMidi', () => ({
    processYeastMidi: vi.fn(),
}));

describe('processRealtimeMidiInput', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should delegate note-on input through the Yeast MIDI processor', () => {
        const processed_events = [
            {
                timeSamples: 512,
                kind: { type: 'noteOn' as const, channel: 1, note: 64, velocity: 88 },
            },
        ];
        vi.mocked(processYeastMidi).mockReturnValue(processed_events);

        const result = processRealtimeMidiInput(60, 96, 2, true, 128, 48000, 64);

        expect(processYeastMidi).toHaveBeenCalledWith(
            [
                {
                    timeSamples: 128,
                    kind: { type: 'noteOn', channel: 2, note: 60, velocity: 96 },
                },
            ],
            128,
            192,
            48000
        );
        expect(result).toBe(processed_events);
    });
});
