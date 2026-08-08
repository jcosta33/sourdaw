import { beforeEach, describe, expect, it, vi } from 'vitest';

import { trackPitch } from '../trackPitch';

const mocks = vi.hoisted(() => ({
    getCachedAudioBuffer: vi.fn(),
    findPitch: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
}));

vi.mock('pitchy', () => ({
    PitchDetector: {
        forFloat32Array: vi.fn(() => ({
            findPitch: mocks.findPitch,
            minVolumeDecibels: 0,
        })),
    },
}));

const SAMPLE_RATE = 44100;

function createMockBuffer(length: number, sampleRate = SAMPLE_RATE) {
    return {
        getChannelData: () => new Float32Array(length),
        sampleRate,
        duration: length / sampleRate,
        length,
        numberOfChannels: 1,
        copyFromChannel: vi.fn(),
        copyToChannel: vi.fn(),
    };
}

describe('trackPitch', () => {
    beforeEach(() => {
        mocks.getCachedAudioBuffer.mockReset();
        mocks.findPitch.mockReset();
    });

    it('returns an empty array when the buffer is not cached', () => {
        mocks.getCachedAudioBuffer.mockReturnValue(null);

        const result = trackPitch('missing-buf');

        expect(result).toEqual([]);
    });

    it('returns pitch results with time, frequency, midi, and note name when clarity exceeds threshold', () => {
        const buf = createMockBuffer(4096);
        mocks.getCachedAudioBuffer.mockReturnValue(buf);
        // 440 Hz = A4 = MIDI 69. Clarity 0.95 > 0.8 threshold.
        mocks.findPitch.mockReturnValue([440, 0.95]);

        const result = trackPitch('buf-1', { windowSize: 2048, hopSize: 2048 });

        // 4096 samples / 2048 hop = 2 windows (offsets 0 and 2048).
        expect(result).toHaveLength(2);
        expect(result[0]?.frequency).toBe(440);
        expect(result[0]?.midiPitch).toBe(69);
        expect(result[0]?.noteName).toBe('A4');
        expect(result[0]?.clarity).toBe(0.95);
        expect(result[0]?.timeSec).toBeCloseTo(0, 5);
        expect(result[1]?.timeSec).toBeCloseTo(2048 / SAMPLE_RATE, 5);
    });

    it('skips detections below the clarity threshold', () => {
        const buf = createMockBuffer(2048);
        mocks.getCachedAudioBuffer.mockReturnValue(buf);
        mocks.findPitch.mockReturnValue([440, 0.5]); // 0.5 < 0.8 default threshold.

        const result = trackPitch('buf-1', { windowSize: 2048, hopSize: 2048 });

        expect(result).toEqual([]);
    });

    it('respects a custom clarity threshold', () => {
        const buf = createMockBuffer(2048);
        mocks.getCachedAudioBuffer.mockReturnValue(buf);
        mocks.findPitch.mockReturnValue([440, 0.6]);

        // With clarityThreshold 0.5, 0.6 passes.
        const result = trackPitch('buf-1', { windowSize: 2048, hopSize: 2048, clarityThreshold: 0.5 });

        expect(result).toHaveLength(1);
    });

    it('skips frequencies outside the 20–5000 Hz valid range', () => {
        const buf = createMockBuffer(2048);
        mocks.getCachedAudioBuffer.mockReturnValue(buf);

        // 10 Hz — below the 20 Hz floor.
        mocks.findPitch.mockReturnValue([10, 0.99]);
        expect(trackPitch('buf-1', { windowSize: 2048, hopSize: 2048 })).toEqual([]);

        // 6000 Hz — above the 5000 Hz ceiling.
        mocks.findPitch.mockReturnValue([6000, 0.99]);
        expect(trackPitch('buf-1', { windowSize: 2048, hopSize: 2048 })).toEqual([]);
    });

    it('computes correct note names for known frequencies', () => {
        const buf = createMockBuffer(2048);
        mocks.getCachedAudioBuffer.mockReturnValue(buf);

        // C4 = 261.63 Hz, MIDI 60.
        mocks.findPitch.mockReturnValue([261.63, 0.9]);
        const c4 = trackPitch('buf-1', { windowSize: 2048, hopSize: 2048 });
        expect(c4[0]?.noteName).toBe('C4');

        // C5 = 523.25 Hz, MIDI 72.
        mocks.findPitch.mockReturnValue([523.25, 0.9]);
        const c5 = trackPitch('buf-1', { windowSize: 2048, hopSize: 2048 });
        expect(c5[0]?.noteName).toBe('C5');
    });

    it('uses default windowSize 2048 and hopSize 512 when options are omitted', () => {
        // 4096 samples with hop 512: windows at 0, 512, 1024, ..., 2048 (last offset
        // where offset + 2048 <= 4096). That's (4096-2048)/512 + 1 = 5 windows.
        const buf = createMockBuffer(4096);
        mocks.getCachedAudioBuffer.mockReturnValue(buf);
        mocks.findPitch.mockReturnValue([440, 0.9]);

        const result = trackPitch('buf-1');

        expect(result).toHaveLength(5);
    });

    it('returns an empty array for a buffer shorter than one window', () => {
        const buf = createMockBuffer(100); // 100 samples << 2048 window.
        mocks.getCachedAudioBuffer.mockReturnValue(buf);
        mocks.findPitch.mockReturnValue([440, 0.9]);

        const result = trackPitch('buf-1');

        expect(result).toEqual([]);
        // Detector never called because the loop body never executes.
        expect(mocks.findPitch).not.toHaveBeenCalled();
    });
});
