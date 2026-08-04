import { vi, type Mock } from 'vitest';

type MockAudioParam = {
    value: number;
    setValueAtTime: Mock;
    setTargetAtTime: Mock;
    linearRampToValueAtTime: Mock;
    exponentialRampToValueAtTime: Mock;
    cancelScheduledValues: Mock;
    cancelAndHoldAtTime: Mock;
    automationRate: AutomationRate;
    defaultValue: number;
    maxValue: number;
    minValue: number;
};

type MockEventTarget = {
    addEventListener: Mock;
    removeEventListener: Mock;
    dispatchEvent: Mock<(event: Event) => boolean>;
};

type MockAudioPlaybackStats = {
    underrunDuration: number;
    underrunEvents: number;
    totalDuration: number;
    averageLatency: number;
    minimumLatency: number;
    maximumLatency: number;
    resetLatency: Mock;
    toJSON: Mock;
};

type MockAudioNodeBase = MockEventTarget & {
    connect: Mock;
    disconnect: Mock;
    connectedTo: AudioNode[];
    disconnectedFrom: AudioNode[];
    channelCount: number;
    channelCountMode: ChannelCountMode;
    channelInterpretation: ChannelInterpretation;
    numberOfInputs: number;
    numberOfOutputs: number;
    context: BaseAudioContext;
};

type MockGainNode = MockAudioNodeBase & { gain: MockAudioParam };
type MockStereoPannerNode = MockAudioNodeBase & { pan: MockAudioParam };
type MockAnalyserNode = MockAudioNodeBase & {
    frequencyBinCount: number;
    fftSize: number;
    minDecibels: number;
    maxDecibels: number;
    smoothingTimeConstant: number;
    getByteTimeDomainData: Mock;
    getFloatTimeDomainData: Mock;
    getFloatFrequencyData: Mock;
    getByteFrequencyData: Mock;
};
type MockBiquadFilterNode = MockAudioNodeBase & {
    type: BiquadFilterType;
    frequency: MockAudioParam;
    Q: MockAudioParam;
    gain: MockAudioParam;
    detune: MockAudioParam;
    getFrequencyResponse: Mock;
};
type MockDynamicsCompressorNode = MockAudioNodeBase & {
    threshold: MockAudioParam;
    knee: MockAudioParam;
    ratio: MockAudioParam;
    attack: MockAudioParam;
    release: MockAudioParam;
    reduction: number;
};
type MockConvolverNode = MockAudioNodeBase & { buffer: AudioBuffer | null; normalize: boolean };
type MockOscillatorNode = MockAudioNodeBase & {
    type: OscillatorType;
    frequency: MockAudioParam;
    detune: MockAudioParam;
    start: Mock;
    stop: Mock;
    setPeriodicWave: Mock;
    onended: ((this: AudioScheduledSourceNode, ev: Event) => unknown) | null;
};
type MockDelayNode = MockAudioNodeBase & { delayTime: MockAudioParam };
type MockBufferSourceNode = MockAudioNodeBase & {
    buffer: AudioBuffer | null;
    playbackRate: MockAudioParam;
    detune: MockAudioParam;
    loop: boolean;
    loopStart: number;
    loopEnd: number;
    start: Mock;
    stop: Mock;
    onended: ((this: AudioScheduledSourceNode, ev: Event) => unknown) | null;
};
type MockChannelNode = MockAudioNodeBase;

type MockAudioWorkletNode = MockAudioNodeBase & {
    parameters: Map<string, MockAudioParam>;
    port: {
        postMessage: Mock;
        onmessage: ((ev: MessageEvent) => void) | null;
        close: Mock;
    };
    onprocessorerror: ((this: AudioWorkletNode, ev: Event) => unknown) | null;
};

type MockAudioNodeKind = {
    gain: MockGainNode;
    'stereo-panner': MockStereoPannerNode;
    analyser: MockAnalyserNode;
    'biquad-filter': MockBiquadFilterNode;
    'buffer-source': MockBufferSourceNode;
    'audio-worklet': MockAudioWorkletNode;
    compressor: MockDynamicsCompressorNode;
    convolver: MockConvolverNode;
    oscillator: MockOscillatorNode;
    delay: MockDelayNode;
    'channel-splitter': MockChannelNode;
    'channel-merger': MockChannelNode;
    destination: MockChannelNode;
};

export type MockAudioContext = MockEventTarget & {
    currentTime: number;
    sampleRate: number;
    state: AudioContextState;
    baseLatency: number;
    outputLatency: number;
    playbackStats: MockAudioPlaybackStats;
    destination: MockChannelNode;
    listener: Record<string, MockAudioParam>;
    audioWorklet: { addModule: Mock };
    onstatechange: ((this: BaseAudioContext, ev: Event) => unknown) | null;
    createGain: Mock<() => MockGainNode>;
    createStereoPanner: Mock<() => MockStereoPannerNode>;
    createChannelSplitter: Mock<(numberOfOutputs?: number) => MockChannelNode>;
    createChannelMerger: Mock<(numberOfInputs?: number) => MockChannelNode>;
    createAnalyser: Mock<() => MockAnalyserNode>;
    createBiquadFilter: Mock<() => MockBiquadFilterNode>;
    createDynamicsCompressor: Mock<() => MockDynamicsCompressorNode>;
    createConvolver: Mock<() => MockConvolverNode>;
    createOscillator: Mock<() => MockOscillatorNode>;
    createDelay: Mock<(maxDelayTime?: number) => MockDelayNode>;
    createBufferSource: Mock<() => MockBufferSourceNode>;
    createBuffer: Mock<(channels: number, length: number, sampleRate: number) => AudioBuffer>;
    createWaveShaper: Mock;
    createPeriodicWave: Mock;
    createIIRFilter: Mock;
    createConstantSource: Mock;
    decodeAudioData: Mock;
    resume: Mock;
    suspend: Mock;
    close: Mock;
};

const createMockAudioParam = (initialValue = 0): MockAudioParam => ({
    value: initialValue,
    setValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
    cancelAndHoldAtTime: vi.fn(),
    automationRate: 'a-rate',
    defaultValue: initialValue,
    maxValue: 3.4028234663852886e38,
    minValue: -3.4028234663852886e38,
});

const createEventTargetMock = (): MockEventTarget => ({
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
});

const createBaseNode = (): MockAudioNodeBase => {
    const node: MockAudioNodeBase = {
        ...createEventTargetMock(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        connectedTo: [],
        disconnectedFrom: [],
        channelCount: 2,
        channelCountMode: 'max',
        channelInterpretation: 'speakers',
        numberOfInputs: 1,
        numberOfOutputs: 1,
        context: createAudioContextShim(),
    };
    node.connect.mockImplementation((target: AudioNode) => {
        node.connectedTo.push(target);
        return target;
    });
    node.disconnect.mockImplementation((target?: AudioNode) => {
        if (target) {
            node.disconnectedFrom.push(target);
        }
    });
    return node;
};

const createAudioContextShim = (): BaseAudioContext => {
    const stub: Partial<BaseAudioContext> = { currentTime: 0, sampleRate: 48000, state: 'running' };
    return stub as BaseAudioContext;
};

const buildGain = (): MockGainNode => ({ ...createBaseNode(), gain: createMockAudioParam(1) });
const buildStereoPanner = (): MockStereoPannerNode => ({ ...createBaseNode(), pan: createMockAudioParam(0) });
const buildAnalyser = (): MockAnalyserNode => ({
    ...createBaseNode(),
    frequencyBinCount: 1024,
    fftSize: 2048,
    minDecibels: -100,
    maxDecibels: -30,
    smoothingTimeConstant: 0.8,
    getByteTimeDomainData: vi.fn(),
    getFloatTimeDomainData: vi.fn(),
    getFloatFrequencyData: vi.fn(),
    getByteFrequencyData: vi.fn(),
});
const buildBiquadFilter = (): MockBiquadFilterNode => ({
    ...createBaseNode(),
    type: 'lowpass',
    frequency: createMockAudioParam(350),
    Q: createMockAudioParam(1),
    gain: createMockAudioParam(0),
    detune: createMockAudioParam(0),
    getFrequencyResponse: vi.fn(),
});
const buildCompressor = (): MockDynamicsCompressorNode => ({
    ...createBaseNode(),
    threshold: createMockAudioParam(-24),
    knee: createMockAudioParam(30),
    ratio: createMockAudioParam(12),
    attack: createMockAudioParam(0.003),
    release: createMockAudioParam(0.25),
    reduction: 0,
});
const buildConvolver = (): MockConvolverNode => ({
    ...createBaseNode(),
    buffer: null,
    normalize: true,
});
const buildOscillator = (): MockOscillatorNode => ({
    ...createBaseNode(),
    type: 'sine',
    frequency: createMockAudioParam(440),
    detune: createMockAudioParam(0),
    start: vi.fn(),
    stop: vi.fn(),
    setPeriodicWave: vi.fn(),
    onended: null,
});
const buildDelay = (): MockDelayNode => ({
    ...createBaseNode(),
    delayTime: createMockAudioParam(0),
});
const buildBufferSource = (): MockBufferSourceNode => ({
    ...createBaseNode(),
    buffer: null,
    playbackRate: createMockAudioParam(1),
    detune: createMockAudioParam(0),
    loop: false,
    loopStart: 0,
    loopEnd: 0,
    start: vi.fn(),
    stop: vi.fn(),
    onended: null,
});
const buildWorklet = (): MockAudioWorkletNode => ({
    ...createBaseNode(),
    parameters: new Map(),
    port: {
        postMessage: vi.fn(),
        onmessage: null,
        close: vi.fn(),
    },
    onprocessorerror: null,
});
const buildChannelNode = (): MockChannelNode => createBaseNode();

export function asBaseAudioContext(ctx: MockAudioContext): BaseAudioContext {
    return ctx as unknown as BaseAudioContext;
}

export function asAudioNode(node: MockAudioNodeBase): AudioNode {
    return node;
}

export function createMockAudioNode<Kind extends keyof MockAudioNodeKind>(kind: Kind): MockAudioNodeKind[Kind] {
    switch (kind) {
        case 'gain':
            return buildGain() as MockAudioNodeKind[Kind];
        case 'stereo-panner':
            return buildStereoPanner() as MockAudioNodeKind[Kind];
        case 'analyser':
            return buildAnalyser() as MockAudioNodeKind[Kind];
        case 'biquad-filter':
            return buildBiquadFilter() as MockAudioNodeKind[Kind];
        case 'buffer-source':
            return buildBufferSource() as MockAudioNodeKind[Kind];
        case 'audio-worklet':
            return buildWorklet() as MockAudioNodeKind[Kind];
        case 'compressor':
            return buildCompressor() as MockAudioNodeKind[Kind];
        case 'convolver':
            return buildConvolver() as MockAudioNodeKind[Kind];
        case 'oscillator':
            return buildOscillator() as MockAudioNodeKind[Kind];
        case 'delay':
            return buildDelay() as MockAudioNodeKind[Kind];
        case 'channel-splitter':
        case 'channel-merger':
        case 'destination':
            return buildChannelNode() as MockAudioNodeKind[Kind];
        default: {
            const exhaustive: never = kind;
            throw new Error(`createMockAudioNode: unsupported kind ${String(exhaustive)}`);
        }
    }
}

export function createMockAudioContext(): MockAudioContext {
    const destination = buildChannelNode();
    const listener: Record<string, MockAudioParam> = {
        positionX: createMockAudioParam(),
        positionY: createMockAudioParam(),
        positionZ: createMockAudioParam(),
        forwardX: createMockAudioParam(),
        forwardY: createMockAudioParam(),
        forwardZ: createMockAudioParam(-1),
        upX: createMockAudioParam(),
        upY: createMockAudioParam(1),
        upZ: createMockAudioParam(),
    };
    const mockCtx: MockAudioContext = {
        ...createEventTargetMock(),
        currentTime: 0,
        sampleRate: 48000,
        state: 'running',
        baseLatency: 0.01,
        outputLatency: 0.01,
        playbackStats: {
            underrunDuration: 0.002,
            underrunEvents: 2,
            totalDuration: 30,
            averageLatency: 0.015,
            minimumLatency: 0.01,
            maximumLatency: 0.02,
            resetLatency: vi.fn(),
            toJSON: vi.fn(),
        },
        destination,
        listener,
        audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
        onstatechange: null,
        createGain: vi.fn(() => buildGain()),
        createStereoPanner: vi.fn(() => buildStereoPanner()),
        createChannelSplitter: vi.fn((_numberOfOutputs = 2) => buildChannelNode()),
        createChannelMerger: vi.fn((_numberOfInputs = 2) => buildChannelNode()),
        createAnalyser: vi.fn(() => buildAnalyser()),
        createBiquadFilter: vi.fn(() => buildBiquadFilter()),
        createDynamicsCompressor: vi.fn(() => buildCompressor()),
        createConvolver: vi.fn(() => buildConvolver()),
        createOscillator: vi.fn(() => buildOscillator()),
        createDelay: vi.fn((_maxDelayTime = 1) => buildDelay()),
        createBufferSource: vi.fn(() => buildBufferSource()),
        createBuffer: vi.fn((channels: number, length: number, sampleRate: number) =>
            MockAudioBuffer.create(channels, length, sampleRate)
        ),
        createWaveShaper: vi.fn(() => createBaseNode()),
        createPeriodicWave: vi.fn(),
        createIIRFilter: vi.fn(() => createBaseNode()),
        createConstantSource: vi.fn(),
        decodeAudioData: vi.fn().mockResolvedValue(MockAudioBuffer.create(2, 1024, 48000)),
        resume: vi.fn().mockResolvedValue(undefined),
        suspend: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
    };
    return mockCtx;
}

export class MockAudioBuffer {
    numberOfChannels: number;
    length: number;
    sampleRate: number;
    duration: number;
    private data: Float32Array<ArrayBuffer>[];

    constructor(options: { numberOfChannels: number; length: number; sampleRate: number }) {
        this.numberOfChannels = options.numberOfChannels;
        this.length = options.length;
        this.sampleRate = options.sampleRate;
        this.duration = options.length / options.sampleRate;
        this.data = Array.from(
            { length: this.numberOfChannels },
            () => new Float32Array(new ArrayBuffer(this.length * 4))
        );
    }

    getChannelData(channel: number): Float32Array<ArrayBuffer> {
        return this.data[channel]!;
    }

    copyFromChannel(destination: Float32Array, channelNumber: number, startInChannel = 0): void {
        const source = this.getChannelData(channelNumber);
        destination.set(source.subarray(startInChannel, startInChannel + destination.length));
    }

    copyToChannel(source: Float32Array, channelNumber: number, startInChannel = 0): void {
        const dest = this.getChannelData(channelNumber);
        dest.set(source, startInChannel);
    }

    static create(channels: number, length: number, sampleRate: number): AudioBuffer {
        return new MockAudioBuffer({ numberOfChannels: channels, length, sampleRate });
    }
}
