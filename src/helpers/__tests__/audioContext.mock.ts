import { vi } from 'vitest';

const createAudioParam = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
});

const createNode = (extra: Record<string, unknown> = {}) => ({
    connect: vi.fn(function (this: unknown, target: unknown) {
        return target;
    }),
    disconnect: vi.fn(),
    ...extra,
});

export function createMockAudioContext() {
    const destination = createNode();
    return {
        currentTime: 0,
        sampleRate: 48000,
        destination,
        createGain: vi.fn(() => createNode({ gain: createAudioParam() })),
        createStereoPanner: vi.fn(() => createNode({ pan: createAudioParam() })),
        createChannelSplitter: vi.fn((_numberOfOutputs = 2) => createNode()),
        createChannelMerger: vi.fn((_numberOfInputs = 2) => createNode()),
        createAnalyser: vi.fn(() =>
            createNode({
                frequencyBinCount: 1024,
                getByteTimeDomainData: vi.fn(),
                getFloatTimeDomainData: vi.fn(),
                getFloatFrequencyData: vi.fn(),
            })
        ),
        createBiquadFilter: vi.fn(() =>
            createNode({
                type: 'lowpass',
                frequency: createAudioParam(),
                Q: createAudioParam(),
                gain: createAudioParam(),
            })
        ),
        createDynamicsCompressor: vi.fn(() =>
            createNode({
                threshold: createAudioParam(),
                knee: createAudioParam(),
                ratio: createAudioParam(),
                attack: createAudioParam(),
                release: createAudioParam(),
                reduction: 0,
            })
        ),
        createConvolver: vi.fn(() =>
            createNode({
                buffer: null,
                normalize: true,
            })
        ),
        createOscillator: vi.fn(() =>
            createNode({
                type: 'sine',
                frequency: createAudioParam(),
                detune: createAudioParam(),
                start: vi.fn(),
                stop: vi.fn(),
            })
        ),
        createDelay: vi.fn((_maxDelayTime = 1) =>
            createNode({
                delayTime: createAudioParam(),
            })
        ),
        createBufferSource: vi.fn(() =>
            createNode({
                buffer: null,
                playbackRate: createAudioParam(),
                start: vi.fn(),
                stop: vi.fn(),
            })
        ),
        createBuffer: vi.fn((channels: number, length: number, sampleRate: number) => ({
            numberOfChannels: channels,
            length,
            sampleRate,
            getChannelData: vi.fn((_: number) => new Float32Array(length)),
        })),
        audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
        resume: vi.fn().mockResolvedValue(undefined),
        suspend: vi.fn().mockResolvedValue(undefined),
    };
}

export class MockAudioBuffer {
    numberOfChannels: number;
    length: number;
    sampleRate: number;
    private data: Float32Array[];

    constructor(options: { numberOfChannels: number; length: number; sampleRate: number }) {
        this.numberOfChannels = options.numberOfChannels;
        this.length = options.length;
        this.sampleRate = options.sampleRate;
        this.data = Array.from({ length: this.numberOfChannels }, () => new Float32Array(this.length));
    }

    getChannelData(channel: number): Float32Array {
        return this.data[channel]!;
    }

    static create(channels: number, length: number, sampleRate: number): AudioBuffer {
        return new MockAudioBuffer({ numberOfChannels: channels, length, sampleRate }) as unknown as AudioBuffer;
    }
}
