import { beforeEach, describe, expect, it, vi } from 'vitest';

const { commitPitchEditWasm, initDawDsp } = vi.hoisted(() => ({
    commitPitchEditWasm: vi.fn(),
    initDawDsp: vi.fn(async () => {}),
}));

vi.mock('#/modules/AudioEngine/wasm/daw_dsp.js', () => ({
    commit_pitch_edit_wasm: commitPitchEditWasm,
    default: initDawDsp,
}));

vi.mock('../../../stores/audioBufferCache', () => ({
    audioBufferCache: {
        get: vi.fn(),
        set: vi.fn(),
    },
}));

import { audioBufferCache } from '../../../stores/audioBufferCache';
import { processPitchEditWasm } from '../processPitchEditWasm';

const CONTOUR = { points: [], sample_rate: 44100, hop_size: 256, algorithm: 'pyin' };

/** Minimal AudioBuffer double: records what each copyToChannel wrote, per
 * channel, so the cached result can be inspected channel by channel. */
class RecordingAudioBuffer {
    length: number;
    numberOfChannels: number;
    sampleRate: number;
    private channels: Float32Array[];

    constructor(options: { length: number; numberOfChannels: number; sampleRate: number }) {
        this.length = options.length;
        this.numberOfChannels = options.numberOfChannels;
        this.sampleRate = options.sampleRate;
        this.channels = Array.from({ length: options.numberOfChannels }, () => new Float32Array(options.length));
    }

    copyToChannel(source: Float32Array, channelIndex: number): void {
        this.channels[channelIndex]!.set(source);
    }

    getChannelData(channelIndex: number): Float32Array {
        return this.channels[channelIndex]!;
    }
}

/** A source-side AudioBuffer double: only `getChannelData` carries behavior —
 * the code under test reads channels and never copies from the source. The
 * remaining members exist to satisfy the AudioBuffer shape. */
function stereoBuffer(left: number[], right: number[]): AudioBuffer {
    return {
        length: left.length,
        duration: left.length / 44100,
        numberOfChannels: 2,
        sampleRate: 44100,
        getChannelData: (channel: number): Float32Array<ArrayBuffer> => new Float32Array(channel === 0 ? left : right),
        copyFromChannel: () => {},
        copyToChannel: () => {},
    };
}

describe('processPitchEditWasm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // The render under test: whatever the DSP receives comes back scaled —
        // close enough to the real PSOLA pass for channel-identity questions,
        // and it makes a mono read of channel 0 impossible to hide.
        commitPitchEditWasm.mockImplementation((data: Float32Array): Float32Array =>
            Float32Array.from(data, (v) => v * 2)
        );
        vi.stubGlobal('AudioBuffer', RecordingAudioBuffer);
    });

    it('commits every channel of a stereo source, with channel identities intact', async () => {
        const left = [0.1, -0.2, 0.3, -0.4];
        const right = [0.8, -0.7, 0.6, -0.5];
        const buffer = stereoBuffer(left, right);

        await processPitchEditWasm(buffer, [], CONTOUR, 'audio-pitch:out', 25, true);

        const cached = vi.mocked(audioBufferCache.set).mock.calls[0]![1];
        expect(cached.numberOfChannels).toBe(2);
        // Expected values rounded through f32, where the render lives.
        expect(Array.from(cached.getChannelData(0))).toEqual(left.map((v) => Math.fround(v * 2)));
        expect(Array.from(cached.getChannelData(1))).toEqual(right.map((v) => Math.fround(v * 2)));
        // Distinct L/R material stayed distinct through the commit.
        expect(Array.from(cached.getChannelData(0))).not.toEqual(Array.from(cached.getChannelData(1)));
    });

    it('renders each channel through the same edit, retune speed and formant setting included', async () => {
        const buffer = stereoBuffer([0.1, 0.2], [0.3, 0.4]);
        const segments = [{ start_time_ms: 0, end_time_ms: 100, shift_semitones: 2 }];

        await processPitchEditWasm(buffer, segments, CONTOUR, 'audio-pitch:out', 120, false);

        expect(commitPitchEditWasm).toHaveBeenCalledTimes(2);
        const calls = vi.mocked(commitPitchEditWasm).mock.calls;
        expect(Array.from(calls[0]![0] as Float32Array)).toEqual([Math.fround(0.1), Math.fround(0.2)]);
        expect(Array.from(calls[1]![0] as Float32Array)).toEqual([Math.fround(0.3), Math.fround(0.4)]);
        // The edit, not the channel, defines the render parameters — including
        // the two live settings the bake must carry (#2058): dropping either
        // argument would bake a render the user never heard.
        expect(calls[1]!.slice(1)).toEqual(calls[0]!.slice(1));
        expect(calls[0]![4]).toBe(120);
        expect(calls[0]![5]).toBe(false);
    });

    it('keeps a mono source a one-channel commit', async () => {
        const buffer: AudioBuffer = {
            length: 3,
            duration: 3 / 44100,
            numberOfChannels: 1,
            sampleRate: 44100,
            getChannelData: (): Float32Array<ArrayBuffer> => new Float32Array([0.5, 0.25, -0.25]),
            copyFromChannel: () => {},
            copyToChannel: () => {},
        };

        await processPitchEditWasm(buffer, [], CONTOUR, 'audio-pitch:out', 0, true);

        expect(commitPitchEditWasm).toHaveBeenCalledTimes(1);
        const cached = vi.mocked(audioBufferCache.set).mock.calls[0]![1];
        expect(cached.numberOfChannels).toBe(1);
        expect(Array.from(cached.getChannelData(0))).toEqual([1.0, 0.5, -0.5]);
    });
});
