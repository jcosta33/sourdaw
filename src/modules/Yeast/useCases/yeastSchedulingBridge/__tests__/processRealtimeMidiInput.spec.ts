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

    it('should delegate note-on input through the Yeast MIDI processor', async () => {
        const processed_events = [
            {
                timeSamples: 512,
                kind: { type: 'noteOn' as const, channel: 1, note: 64, velocity: 88 },
            },
        ];
        vi.mocked(processYeastMidi).mockResolvedValue(processed_events);

        const context = {} as BaseAudioContext;
        const result = await processRealtimeMidiInput({
            context,
            trackId: 'track-a',
            note: 60,
            velocity: 96,
            channel: 2,
            isNoteOn: true,
            sampleTime: 128,
            sampleRate: 48000,
            blockSize: 64,
        });

        expect(processYeastMidi).toHaveBeenCalledWith(
            expect.objectContaining({
                context,
                trackId: 'track-a',
                events: [
                    {
                        timeSamples: 128,
                        trackId: 'track-a',
                        sourceEventId: 'track-a:2:60:on:128',
                        timePpq: 0,
                        tempoBpm: 120,
                        kind: { type: 'noteOn', channel: 2, note: 60, velocity: 96 },
                    },
                ],
                blockStartSamples: 128,
                blockEndSamples: 12129,
            })
        );
        expect(result).toBe(processed_events);
    });

    it('pumps a bounded positive-offset horizon so realtime final output can be scheduled ahead', async () => {
        vi.mocked(processYeastMidi).mockResolvedValue([]);

        await processRealtimeMidiInput({
            context: {} as BaseAudioContext,
            trackId: 'track-a',
            note: 60,
            velocity: 96,
            channel: 0,
            isNoteOn: true,
            sampleTime: 128,
            sampleRate: 48_000,
            blockSize: 64,
        });

        expect(vi.mocked(processYeastMidi).mock.calls[0]?.[0].blockEndSamples).toBeGreaterThan(192);
    });
});
