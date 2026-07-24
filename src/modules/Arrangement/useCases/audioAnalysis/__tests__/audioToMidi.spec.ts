import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as subject from '../audioToMidi';

type FakeBuffer = {
    sampleRate: number;
    length: number;
    channel: Float32Array;
    getChannelData: (n: number) => Float32Array;
};

const mocks = vi.hoisted(() => ({
    getBufferForClip: vi.fn<(clipId: string) => { buffer: FakeBuffer; audioBufferId: string } | null>(),
    addTrack: vi.fn<(input: { name: string; kind: string }) => { id: string } | null>(),
    addClip: vi.fn<(input: Record<string, unknown>) => { id: string } | null>(),
    addMidiNote: vi.fn(),
}));

vi.mock('../helpers', () => ({
    getBufferForClip: (clipId: string) => mocks.getBufferForClip(clipId),
}));

vi.mock('../../addTrack', () => ({
    addTrack: (input: { name: string; kind: string }) => mocks.addTrack(input),
}));

vi.mock('../../clip/addClip', () => ({
    addClip: (input: Record<string, unknown>) => mocks.addClip(input),
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    addMidiNote: mocks.addMidiNote,
}));

function makeBuffer(channel: Float32Array, sampleRate = 8000): FakeBuffer {
    return {
        sampleRate,
        length: channel.length,
        channel,
        getChannelData: (n: number) => (n === 0 ? channel : new Float32Array(0)),
    };
}

describe('audioToMidi', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('aborts when no audio buffer is cached for the clip', async () => {
        mocks.getBufferForClip.mockReturnValue(null);

        await subject.audioToMidi('missing');

        expect(mocks.addTrack).not.toHaveBeenCalled();
    });

    it('aborts when the target MIDI track cannot be created', async () => {
        mocks.getBufferForClip.mockReturnValue({ buffer: makeBuffer(new Float32Array(10)), audioBufferId: 'b1' });
        mocks.addTrack.mockReturnValue(null);

        await subject.audioToMidi('c1');

        expect(mocks.addClip).not.toHaveBeenCalled();
    });

    it('aborts when the destination MIDI clip cannot be created', async () => {
        mocks.getBufferForClip.mockReturnValue({ buffer: makeBuffer(new Float32Array(10)), audioBufferId: 'b1' });
        mocks.addTrack.mockReturnValue({ id: 't1' });
        mocks.addClip.mockReturnValue(null);

        await subject.audioToMidi('c1');

        expect(mocks.addMidiNote).not.toHaveBeenCalled();
    });

    it('emits a MIDI note per detected onset with pitch derived from zero crossings', async () => {
        // Single strong onset at sample 0; remaining signal is near-zero so no
        // further onsets fire. maxAmp = 1.0 => onsetThreshold = 0.4.
        const channel = new Float32Array(4096);
        channel[0] = 1.0;
        mocks.getBufferForClip.mockReturnValue({
            buffer: makeBuffer(channel, 8000),
            audioBufferId: 'b1',
        });
        mocks.addTrack.mockReturnValue({ id: 't1' });
        mocks.addClip.mockReturnValue({ id: 'clip-out' });

        await subject.audioToMidi('c1');

        expect(mocks.addMidiNote).toHaveBeenCalledTimes(1);
        const [clipId, pitch, beatPos, duration, velocity] = mocks.addMidiNote.mock.calls[0] ?? [];
        expect(clipId).toBe('clip-out');
        // Onset at sample 0, sampleRate 8000 => beat 0.
        expect(beatPos).toBe(0);
        expect(duration).toBe(0.25);
        // |onset|/maxAmp = 1.0 => velocity clamps to 127.
        expect(velocity).toBe(127);
        // Pitch must land within the piano range regardless of frequency fit.
        expect(pitch).toBeGreaterThanOrEqual(21);
        expect(pitch).toBeLessThanOrEqual(108);
    });
});
