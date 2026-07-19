import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { projectClipMidiEvents } from '#/modules/MIDI/useCases';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Track } from '../../../models/Track';
import { setOfflineRenderDependencies } from '../offlineRenderDependencies';
import { renderTrackOffline } from '../renderOffline';

import type { buildDeviceChain, getAudioContext, getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';

type MidiStoreNote = { id: string; pitch: number; startBeat: number; duration: number; velocity: number };

type RenderOfflineMocks = {
    buildDeviceChain: Mock<typeof buildDeviceChain>;
    getAudioContext: Mock<typeof getAudioContext>;
    getCachedAudioBuffer: Mock<typeof getCachedAudioBuffer>;
    getUpstreamSubgraph: Mock<() => Set<string>>;
    trackStore: { value: unknown };
    midiStore: { value: { notesByClipId: Record<string, MidiStoreNote[]> } | null };
    transportStore: { value: unknown };
    tempoMapStore: { value: unknown };
    projectClipMidiEvents: Mock<typeof projectClipMidiEvents>;
};

const mocks = vi.hoisted<RenderOfflineMocks>(() => ({
    buildDeviceChain: vi.fn<typeof buildDeviceChain>(),
    getAudioContext: vi.fn<typeof getAudioContext>(),
    getCachedAudioBuffer: vi.fn<typeof getCachedAudioBuffer>(),
    getUpstreamSubgraph: vi.fn<() => Set<string>>(),
    trackStore: { value: null },
    midiStore: { value: null },
    transportStore: { value: null },
    tempoMapStore: { value: { changes: [] } },
    projectClipMidiEvents: vi.fn<typeof projectClipMidiEvents>(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    buildDeviceChain: mocks.buildDeviceChain,
    getAudioContext: mocks.getAudioContext,
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
    projectOfflineYeastNotes: vi.fn(),
}));

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: mocks.midiStore,
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    projectClipMidiEvents: mocks.projectClipMidiEvents,
}));

vi.mock('#/modules/Transport/stores', () => ({
    transportStore: mocks.transportStore,
    tempoMapStore: mocks.tempoMapStore,
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

type FakeOscillatorNode = FakeConnectableNode & {
    type: string;
    frequency: FakeAudioParam;
    start: (when?: number) => void;
    stop: (when?: number) => void;
};

const createdSources: FakeSourceNode[] = [];
const createdGains: Array<FakeConnectableNode & { gain: FakeAudioParam }> = [];
const createdOscillators: FakeOscillatorNode[] = [];
let renderedBuffer: AudioBuffer | null = null;

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

/** Minimal AudioBuffer constructor stand-in for normalize/trim paths that allocate fresh buffers. */
class FakeAudioBufferCtor {
    readonly length: number;
    readonly numberOfChannels: number;
    readonly sampleRate: number;
    private readonly channels: Float32Array[];

    constructor(options: { length: number; numberOfChannels: number; sampleRate: number }) {
        this.length = options.length;
        this.numberOfChannels = options.numberOfChannels;
        this.sampleRate = options.sampleRate;
        this.channels = Array.from({ length: options.numberOfChannels }, () => new Float32Array(options.length));
    }

    get duration(): number {
        return this.length / this.sampleRate;
    }

    getChannelData(channel: number): Float32Array {
        return this.channels[channel] ?? new Float32Array(this.length);
    }

    copyToChannel(source: Float32Array, channel: number, startInChannel = 0): void {
        this.channels[channel]?.set(source, startInChannel);
    }

    copyFromChannel(destination: Float32Array, channel: number, startInChannel = 0): void {
        const data = this.getChannelData(channel);
        destination.set(data.subarray(startInChannel, startInChannel + destination.length));
    }
}

class FakeOfflineAudioContext {
    readonly destination = createFakeConnectableNode();

    constructor(
        readonly numberOfChannels: number,
        readonly length: number,
        readonly sampleRate: number
    ) {}

    createGain() {
        const gain = { ...createFakeConnectableNode(), gain: createFakeAudioParam() };
        createdGains.push(gain);
        return gain;
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

    createOscillator(): FakeOscillatorNode {
        const oscillator = {
            ...createFakeConnectableNode(),
            type: 'sine',
            frequency: createFakeAudioParam(),
            start: vi.fn(),
            stop: vi.fn(),
        };
        createdOscillators.push(oscillator);
        return oscillator;
    }

    resume(): Promise<void> {
        return Promise.resolve();
    }

    startRendering(): Promise<AudioBuffer> {
        return Promise.resolve(renderedBuffer ?? createFakeAudioBuffer());
    }

    suspend(): Promise<void> {
        return Promise.resolve();
    }
}

describe('renderTrackOffline', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);
        vi.stubGlobal('AudioBuffer', FakeAudioBufferCtor);
        createdSources.length = 0;
        createdGains.length = 0;
        createdOscillators.length = 0;
        renderedBuffer = null;
        mocks.trackStore.value = null;
        mocks.midiStore.value = null;
        mocks.transportStore.value = null;
        mocks.buildDeviceChain.mockResolvedValue([]);
        mocks.getAudioContext.mockReturnValue({ sampleRate: 44100 } as AudioContext);
        mocks.getCachedAudioBuffer.mockReturnValue(null);
        mocks.getUpstreamSubgraph.mockReturnValue(new Set<string>());
        setOfflineRenderDependencies({
            projectPpqEndpoints: ({ startPpq, endPpq, defaultTempo, sampleRate }) => {
                const startSamples = Math.round((startPpq / defaultTempo) * 60 * sampleRate);
                const endSamples = Math.round((endPpq / defaultTempo) * 60 * sampleRate);
                return {
                    startSamples,
                    endSamples,
                    durationSamples: endSamples - startSamples,
                    startSeconds: startSamples / sampleRate,
                    endSeconds: endSamples / sampleRate,
                    durationSeconds: (endSamples - startSamples) / sampleRate,
                };
            },
            createMidiEventProjector: () => projectClipMidiEvents,
            createYeastMidiProcessor: () => (input) => input.events,
        });
        mocks.projectClipMidiEvents.mockImplementation((input) =>
            input.events.map((event) => ({
                ...event,
                startBeat: input.iterationStartBeat + event.startBeat - input.midiOffsetBeats,
            }))
        );
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

    it('should project committed groove timing and dynamics for freeze and bounce renders', async () => {
        const midiClip = ClipDummy.create({
            id: 'clip-midi',
            trackId: 'track-midi',
            type: 'midi',
            startBeat: 0,
            endBeat: 4,
        });
        const midiTrack = TrackDummy.create({
            id: 'track-midi',
            kind: 'midi',
            clips: [midiClip],
            devices: [],
        });
        const sourceNotes = [{ id: 'note-1', pitch: 60, startBeat: 1, duration: 1, velocity: 100 }];
        mocks.trackStore.value = { tracks: [midiTrack], selectedTrackId: 'track-midi', ghostClips: [] };
        mocks.midiStore.value = { notesByClipId: { 'clip-midi': sourceNotes } };
        mocks.transportStore.value = { tempo: 120 };
        mocks.projectClipMidiEvents.mockReturnValue([{ ...sourceNotes[0]!, startBeat: 1.5, velocity: 40 }]);

        await renderTrackOffline(midiTrack, 0, 4, { includeInserts: false });

        expect(mocks.projectClipMidiEvents).toHaveBeenCalledWith({
            events: sourceNotes,
            clipId: 'clip-midi',
            clipStartBeat: 0,
            clipEndBeat: 4,
            iterationStartBeat: 0,
            loopLengthBeats: 4,
            midiOffsetBeats: 0,
            loopEnabled: false,
        });
        expect(createdOscillators[0]?.start).toHaveBeenCalledWith(0.75);
        expect(createdGains.at(-1)?.gain.linearRampToValueAtTime).toHaveBeenCalledWith((40 / 127) * 0.3, 0.755);
    });

    it('schedules cached audio clips at clip-relative offsets and skips uncached ones', async () => {
        const clipBuffer = createFakeAudioBuffer(2);
        const cached = ClipDummy.create({ id: 'c1', startBeat: 1, endBeat: 3, audioBufferId: 'buffer-1' });
        const uncached = ClipDummy.create({ id: 'c2', startBeat: 3, endBeat: 4, audioBufferId: 'missing' });
        const track = TrackDummy.create({ id: 'track-1', kind: 'audio', clips: [cached, uncached] });
        mocks.trackStore.value = { tracks: [track], selectedTrackId: 'track-1', ghostClips: [] };
        mocks.getCachedAudioBuffer.mockImplementation(({ bufferId }) => (bufferId === 'buffer-1' ? clipBuffer : null));

        await renderTrackOffline(track, 0, 4, { includeInserts: false });

        expect(createdSources).toHaveLength(1);
        expect(createdSources[0]?.buffer).toBe(clipBuffer);
        // 120 bpm: clip start at beat 1 = 0.5s, clip length 2 beats = 1s (shorter than the 2s buffer).
        expect(createdSources[0]?.start).toHaveBeenCalledWith(0.5, 0, 1);
    });

    it('schedules a fallback synth voice for midi notes', async () => {
        const clip = ClipDummy.create({ id: 'clip-m', startBeat: 1, endBeat: 3, type: 'midi' });
        const track = TrackDummy.create({ id: 'track-1', kind: 'midi', clips: [clip] });
        mocks.trackStore.value = { tracks: [track], selectedTrackId: 'track-1', ghostClips: [] };
        mocks.midiStore.value = {
            notesByClipId: {
                'clip-m': [{ id: 'n1', pitch: 69, startBeat: 0, duration: 1, velocity: 127 }],
            },
        };

        await renderTrackOffline(track, 0, 4, { includeInserts: false });

        expect(createdOscillators).toHaveLength(1);
        const oscillator = createdOscillators[0];
        // A4 (MIDI 69) = 440 Hz; note starts at beat 1 = 0.5s and lasts 0.5s at 120 bpm.
        expect(oscillator?.frequency.value).toBeCloseTo(440, 5);
        expect(oscillator?.start).toHaveBeenCalledWith(0.5);
        expect(oscillator?.stop).toHaveBeenCalledWith(1.01);
    });

    it('applies full normalization to the rendered buffer', async () => {
        const raw = createFakeAudioBuffer(1);
        raw.getChannelData(0)[0] = 0.5;
        raw.getChannelData(0)[10] = -0.25;
        renderedBuffer = raw;

        const track = TrackDummy.create({ id: 'track-1', kind: 'audio', clips: [] });
        mocks.trackStore.value = { tracks: [track], selectedTrackId: 'track-1', ghostClips: [] };

        const result = await renderTrackOffline(track, 0, 4, { includeInserts: false, normalization: 'full' });

        // Peak 0.5 is scaled to -0.1 dB (0.99), other samples proportionally.
        expect(result).not.toBe(raw);
        expect(result?.getChannelData(0)[0]).toBeCloseTo(0.99, 5);
        expect(result?.getChannelData(0)[10]).toBeCloseTo(-0.495, 5);
    });

    it('returns the buffer untouched when protection normalization sees a safe peak', async () => {
        const raw = createFakeAudioBuffer(1);
        raw.getChannelData(0)[0] = 0.5;
        renderedBuffer = raw;

        const track = TrackDummy.create({ id: 'track-1', kind: 'audio', clips: [] });
        mocks.trackStore.value = { tracks: [track], selectedTrackId: 'track-1', ghostClips: [] };

        const result = await renderTrackOffline(track, 0, 4, { includeInserts: false, normalization: 'protection' });

        expect(result).toBe(raw);
    });

    it('rejects when the abort signal is already aborted', async () => {
        const controller = new AbortController();
        controller.abort();

        const track = TrackDummy.create({ id: 'track-1', kind: 'audio', clips: [] });
        mocks.trackStore.value = { tracks: [track], selectedTrackId: 'track-1', ghostClips: [] };

        await expect(
            renderTrackOffline(track, 0, 4, { includeInserts: false, abortSignal: controller.signal })
        ).rejects.toThrow('Render aborted');
    });
});
