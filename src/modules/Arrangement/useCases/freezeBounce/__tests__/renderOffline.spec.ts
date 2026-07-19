import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { projectClipMidiEvents, type projectCommittedGroove } from '#/modules/MIDI/useCases';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Track } from '../../../models/Track';
import { setOfflineRenderDependencies } from '../offlineRenderDependencies';
import { renderTrackOffline } from '../renderOffline';

import type { buildDeviceChain, getAudioContext, getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';

type RenderOfflineMocks = {
    buildDeviceChain: Mock<typeof buildDeviceChain>;
    getAudioContext: Mock<typeof getAudioContext>;
    getCachedAudioBuffer: Mock<typeof getCachedAudioBuffer>;
    getUpstreamSubgraph: Mock<() => Set<string>>;
    trackStore: { value: unknown };
    midiStore: { value: unknown };
    transportStore: { value: unknown };
    tempoMapStore: { value: unknown };
    projectClipMidiEvents: Mock<typeof projectClipMidiEvents>;
    projectCommittedGroove: Mock<typeof projectCommittedGroove>;
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
    projectCommittedGroove: vi.fn<typeof projectCommittedGroove>(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    buildDeviceChain: mocks.buildDeviceChain,
    getAudioContext: mocks.getAudioContext,
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
}));

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: mocks.midiStore,
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    projectClipMidiEvents: mocks.projectClipMidiEvents,
    projectCommittedGroove: mocks.projectCommittedGroove,
}));

vi.mock('#/modules/Transport/stores', () => ({
    transportStore: mocks.transportStore,
    tempoMapStore: mocks.tempoMapStore,
}));

const projectPpqEndpoints = ({
    startPpq,
    endPpq,
    defaultTempo,
    sampleRate,
}: {
    startPpq: number;
    endPpq: number;
    defaultTempo: number;
    sampleRate: number;
}) => {
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
};

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

type FakeGainNode = FakeConnectableNode & { gain: FakeAudioParam };
type FakeOscillatorNode = FakeConnectableNode & {
    type: OscillatorType;
    frequency: FakeAudioParam;
    start: (when?: number) => void;
    stop: (when?: number) => void;
};

const createdSources: FakeSourceNode[] = [];
const createdGains: FakeGainNode[] = [];
const createdOscillators: FakeOscillatorNode[] = [];

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
            type: 'sine' as OscillatorType,
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
        createdGains.length = 0;
        createdOscillators.length = 0;
        mocks.trackStore.value = null;
        mocks.midiStore.value = null;
        mocks.transportStore.value = null;
        mocks.buildDeviceChain.mockResolvedValue([]);
        mocks.getAudioContext.mockReturnValue({ sampleRate: 44100 } as AudioContext);
        mocks.getCachedAudioBuffer.mockReturnValue(null);
        mocks.getUpstreamSubgraph.mockReturnValue(new Set<string>());
        setOfflineRenderDependencies({
            projectPpqEndpoints,
            createMidiEventProjector: () => projectClipMidiEvents,
        });
        mocks.projectCommittedGroove.mockImplementation(({ events }) => events);
        mocks.projectClipMidiEvents.mockImplementation((input) => {
            const clipProjected = mocks.projectCommittedGroove({
                events: input.events,
                consumerType: 'clip',
                consumerId: input.clipId,
            });
            return input.events.flatMap((event, index) => {
                const grooveEvent = clipProjected[index] ?? event;
                const projectedStart = input.iterationStartBeat + grooveEvent.startBeat - input.midiOffsetBeats;
                const startBeat = Math.max(input.iterationStartBeat, input.clipStartBeat, projectedStart);
                const endBeat = Math.min(input.clipEndBeat, projectedStart + event.duration);
                const duration = Math.max(0, endBeat - startBeat);
                return duration > 0 ? [{ ...event, startBeat, duration, velocity: grooveEvent.velocity }] : [];
            });
        });
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

    it('projects committed groove timing and dynamics for freeze and bounce renders', async () => {
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
        mocks.midiStore.value = {
            notesByClipId: {
                'clip-midi': sourceNotes,
            },
        };
        mocks.transportStore.value = { tempo: 120 };
        mocks.projectCommittedGroove.mockImplementation(({ events }) =>
            events.map((event) => ({ ...event, startBeat: 1.5, velocity: 40 }))
        );

        await renderTrackOffline(midiTrack, 0, 4, { includeInserts: false });

        expect(mocks.projectCommittedGroove).toHaveBeenCalledWith({
            events: sourceNotes,
            consumerType: 'clip',
            consumerId: 'clip-midi',
        });
        expect(createdOscillators[0]?.start).toHaveBeenCalledWith(0.75);
        const envelope = createdGains.at(-1);
        expect(envelope?.gain.linearRampToValueAtTime).toHaveBeenCalledWith((40 / 127) * 0.3, 0.755);
    });
});
