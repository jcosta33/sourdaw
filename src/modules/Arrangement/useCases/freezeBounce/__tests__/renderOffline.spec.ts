import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Track } from '../../../models/Track';
import { renderTrackOffline } from '../renderOffline';

import type { buildDeviceChain, getAudioContext, getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';

type RenderOfflineMocks = {
    buildDeviceChain: Mock<typeof buildDeviceChain>;
    getAudioContext: Mock<typeof getAudioContext>;
    getCachedAudioBuffer: Mock<typeof getCachedAudioBuffer>;
    getUpstreamSubgraph: Mock<() => Set<string>>;
    trackStore: { value: unknown };
};

const mocks = vi.hoisted<RenderOfflineMocks>(() => ({
    buildDeviceChain: vi.fn<typeof buildDeviceChain>(),
    getAudioContext: vi.fn<typeof getAudioContext>(),
    getCachedAudioBuffer: vi.fn<typeof getCachedAudioBuffer>(),
    getUpstreamSubgraph: vi.fn<() => Set<string>>(),
    trackStore: { value: null },
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    buildDeviceChain: mocks.buildDeviceChain,
    getAudioContext: mocks.getAudioContext,
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
}));

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: { value: null },
}));

vi.mock('#/modules/Transport/stores', () => ({
    transportStore: { value: null },
}));

vi.mock('#/modules/Routing/stores', () => ({
    sidechainStore: { value: null },
}));

vi.mock('../../../stores/trackStore', () => ({
    trackStore: mocks.trackStore,
}));

vi.mock('../../../services/getUpstreamSubgraph', () => ({
    getUpstreamSubgraph: mocks.getUpstreamSubgraph,
}));

type FakeAudioParam = {
    value: number;
    setValueAtTime: (value: number, startTime: number) => void;
    linearRampToValueAtTime: (value: number, endTime: number) => void;
    exponentialRampToValueAtTime: (value: number, endTime: number) => void;
};

type FakeConnectableNode = {
    connect: (destination: unknown, output?: number, input?: number) => unknown;
};

type FakeSourceNode = FakeConnectableNode & {
    buffer: AudioBuffer | null;
    playbackRate: FakeAudioParam;
    start: (when?: number, offset?: number, duration?: number) => void;
    stop: (when?: number) => void;
};

const createdSources: FakeSourceNode[] = [];

function createFakeAudioParam(): FakeAudioParam {
    return {
        value: 0,
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
    };
}

function createFakeConnectableNode(): FakeConnectableNode {
    return {
        connect: vi.fn((destination: unknown) => destination),
    };
}

function createFakeAudioBuffer(duration = 1): AudioBuffer {
    const sampleRate = 44_100;
    const channelData = new Float32Array(Math.ceil(duration * sampleRate));
    return {
        copyFromChannel: (destination, _channelNumber, startInChannel = 0) => {
            destination.set(channelData.subarray(startInChannel, startInChannel + destination.length));
        },
        copyToChannel: (source, _channelNumber, startInChannel = 0) => {
            channelData.set(source, startInChannel);
        },
        duration,
        getChannelData: () => channelData,
        length: channelData.length,
        numberOfChannels: 1,
        sampleRate,
    };
}

class FakeOfflineAudioContext {
    readonly destination = createFakeConnectableNode();

    constructor(
        readonly numberOfChannels: number,
        readonly length: number,
        readonly sampleRate: number
    ) {}

    createGain() {
        return { ...createFakeConnectableNode(), gain: createFakeAudioParam() };
    }

    createStereoPanner() {
        return { ...createFakeConnectableNode(), pan: createFakeAudioParam() };
    }

    createBufferSource(): FakeSourceNode {
        const source = {
            ...createFakeConnectableNode(),
            buffer: null,
            playbackRate: createFakeAudioParam(),
            start: vi.fn(),
            stop: vi.fn(),
        };
        createdSources.push(source);
        return source;
    }

    resume(): Promise<void> {
        return Promise.resolve();
    }

    startRendering(): Promise<AudioBuffer> {
        return Promise.resolve(createFakeAudioBuffer());
    }

    suspend(): Promise<void> {
        return Promise.resolve();
    }
}

describe('renderTrackOffline', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);
        createdSources.length = 0;
        mocks.trackStore.value = null;
        mocks.buildDeviceChain.mockResolvedValue([]);
        mocks.getAudioContext.mockReturnValue({ sampleRate: 44100 } as AudioContext);
        mocks.getCachedAudioBuffer.mockReturnValue(null);
        mocks.getUpstreamSubgraph.mockReturnValue(new Set<string>());
    });

    it('should not build a device chain for non-audio non-midi tracks', async () => {
        const busTrack = { kind: 'bus', clips: [], devices: [] } as unknown as Track;
        const result = await renderTrackOffline(busTrack, 0, 4);

        expect(result).toBeNull();
        expect(mocks.buildDeviceChain).not.toHaveBeenCalled();
    });

    it('should read frozen-track buffers through the AudioEngine cache use case', async () => {
        const frozenBuffer = createFakeAudioBuffer(4);
        const frozenTrack = TrackDummy.create({
            id: 'track-1',
            frozen: true,
            frozenBufferId: 'frozen-buffer-1',
            clips: [ClipDummy.create({ startBeat: 2, endBeat: 4 })],
        });
        mocks.trackStore.value = { tracks: [frozenTrack], selectedTrackId: 'track-1', ghostClips: [] };
        mocks.getCachedAudioBuffer.mockReturnValue(frozenBuffer);

        await renderTrackOffline(frozenTrack, 1, 5, { includeInserts: false });

        expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'frozen-buffer-1' });
        expect(createdSources).toHaveLength(1);
        expect(createdSources[0]?.buffer).toBe(frozenBuffer);
        expect(createdSources[0]?.start).toHaveBeenCalledWith(0.5);
    });
});
