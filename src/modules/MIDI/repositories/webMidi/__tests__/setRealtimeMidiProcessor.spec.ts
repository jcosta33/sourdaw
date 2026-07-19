import { describe, expect, it, vi } from 'vitest';

import { processRealtimeMidiInput } from '../processRealtimeMidiInput';
import { setRealtimeMidiProcessor } from '../setRealtimeMidiProcessor';

import type { RealtimeMidiInput, RealtimeMidiProcessor } from '../realtimeMidiProcessorState';

const input: RealtimeMidiInput = {
    context: { sampleRate: 48_000 } as BaseAudioContext,
    rackId: 'rack-1',
    trackId: 'track-1',
    note: 60,
    velocity: 0.75,
    channel: 0,
    isNoteOn: true,
    sampleTime: 1_000,
    sampleRate: 48_000,
};

describe('setRealtimeMidiProcessor', () => {
    it('restores pass-through processing when the active registration is disposed', async () => {
        const processor = vi.fn<RealtimeMidiProcessor>().mockResolvedValue([]);
        const dispose = setRealtimeMidiProcessor(processor);

        expect(await processRealtimeMidiInput(input)).toEqual([]);
        dispose();
        dispose();

        expect(await processRealtimeMidiInput(input)).toEqual([
            {
                timeSamples: 1_000,
                trackId: 'track-1',
                kind: { type: 'noteOn', channel: 0, note: 60, velocity: 0.75 },
            },
        ]);
    });

    it('does not let a stale disposer clear a newer registration', async () => {
        const first = vi.fn<RealtimeMidiProcessor>().mockResolvedValue([]);
        const secondEvent = {
            timeSamples: 1_024,
            trackId: 'track-1',
            kind: { type: 'noteOff' as const, channel: 0, note: 60 },
        };
        const second = vi.fn<RealtimeMidiProcessor>().mockResolvedValue([secondEvent]);
        const disposeFirst = setRealtimeMidiProcessor(first);
        const disposeSecond = setRealtimeMidiProcessor(second);

        disposeFirst();

        expect(await processRealtimeMidiInput(input)).toEqual([secondEvent]);
        disposeSecond();
    });
});
