import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Track } from '../../../models/Track';
import { renderTrackOffline } from '../renderOffline';

import type { renderTrackSubgraphOffline } from '#/modules/AudioEngine/useCases';

type RenderOfflineMocks = {
    renderTrackSubgraphOffline: Mock<typeof renderTrackSubgraphOffline>;
    getUpstreamSubgraph: Mock<() => Set<string>>;
    trackStore: { value: unknown };
    sidechainStore: { value: unknown };
};

const mocks = vi.hoisted<RenderOfflineMocks>(() => ({
    renderTrackSubgraphOffline: vi.fn<typeof renderTrackSubgraphOffline>(),
    getUpstreamSubgraph: vi.fn<() => Set<string>>(),
    trackStore: { value: null },
    sidechainStore: { value: null },
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    renderTrackSubgraphOffline: mocks.renderTrackSubgraphOffline,
}));

vi.mock('#/modules/Routing/stores', () => ({
    sidechainStore: mocks.sidechainStore,
}));

vi.mock('../../../stores/trackStore', () => ({
    trackStore: mocks.trackStore,
}));

vi.mock('../../../services/getUpstreamSubgraph', () => ({
    getUpstreamSubgraph: mocks.getUpstreamSubgraph,
}));

/** Minimal AudioBuffer constructor stand-in for the trim/normalize paths. */
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

function createAudioBuffer(samples: readonly number[], sampleRate = 44_100): AudioBuffer {
    const channelData = Float32Array.from(samples);
    return {
        copyFromChannel: (destination, _channelNumber, startInChannel = 0) => {
            destination.set(channelData.subarray(startInChannel, startInChannel + destination.length));
        },
        copyToChannel: (source, _channelNumber, startInChannel = 0) => {
            channelData.set(source, startInChannel);
        },
        duration: channelData.length / sampleRate,
        getChannelData: () => channelData,
        length: channelData.length,
        numberOfChannels: 1,
        sampleRate,
    };
}

type IneligibleRoutingResidueInput = {
    id: string;
    kind: 'vca' | 'malformed';
    relation: 'output' | 'send' | 'sidechain';
    targetId: string;
};

const INELIGIBLE_ROUTING_KINDS = ['vca', 'malformed'] satisfies IneligibleRoutingResidueInput['kind'][];
const ROUTING_RELATIONS = ['output', 'send', 'sidechain'] satisfies IneligibleRoutingResidueInput['relation'][];

function createIneligibleRoutingResidue(input: IneligibleRoutingResidueInput): Track {
    const track = TrackDummy.create({
        id: input.id,
        kind: 'audio',
        devices: [
            {
                id: `${input.id}-device`,
                name: 'Dormant device residue',
                type: 'compressor',
                bypassed: false,
                parameterValues: {},
            },
        ],
        frozen: true,
        frozenBufferId: `${input.id}-frozen-buffer`,
    });
    if (input.relation === 'output') {
        track.outputId = input.targetId;
    }
    if (input.relation === 'send') {
        track.sends = [{ busId: input.targetId, level: 0.5, preFader: false }];
    }
    Object.defineProperty(track, 'kind', {
        value: input.kind,
        configurable: true,
        enumerable: true,
        writable: true,
    });
    return track;
}

describe('renderTrackOffline', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('AudioBuffer', FakeAudioBufferCtor);
        mocks.trackStore.value = null;
        mocks.sidechainStore.value = null;
        mocks.getUpstreamSubgraph.mockReturnValue(new Set<string>());
        mocks.renderTrackSubgraphOffline.mockResolvedValue(createAudioBuffer([0.25]));
    });

    it.each([
        { kind: 'bus', label: 'bus' },
        { kind: 'master', label: 'master' },
    ] satisfies { kind: Track['kind']; label: string }[])(
        'renders nothing for a %s track, which has no sound source of its own',
        async ({ kind }) => {
            const track = TrackDummy.create({ id: 'structural', kind });

            const result = await renderTrackOffline(track, 0, 4);

            expect(result).toBeNull();
            expect(mocks.renderTrackSubgraphOffline).not.toHaveBeenCalled();
        }
    );

    it('returns before touching the render graph for a dormant VCA', async () => {
        const dormantVca = TrackDummy.create({ id: 'vca-1' });
        Object.defineProperty(dormantVca, 'kind', { value: 'vca' });

        const result = await renderTrackOffline(dormantVca, 0, 4);

        expect(result).toBeNull();
        expect(mocks.getUpstreamSubgraph).not.toHaveBeenCalled();
        expect(mocks.renderTrackSubgraphOffline).not.toHaveBeenCalled();
    });

    it('excludes dormant and malformed routing predecessors from the render subgraph', async () => {
        const target = TrackDummy.create({ id: 'ordinary-target', kind: 'audio' });
        const ineligibleTracks = INELIGIBLE_ROUTING_KINDS.flatMap((kind) =>
            ROUTING_RELATIONS.map((relation) =>
                createIneligibleRoutingResidue({
                    id: `${kind}-${relation}`,
                    kind,
                    relation,
                    targetId: target.id,
                })
            )
        );
        mocks.trackStore.value = {
            tracks: [target, ...ineligibleTracks],
            selectedTrackId: target.id,
            ghostClips: [],
        };
        mocks.getUpstreamSubgraph.mockReturnValue(new Set(ineligibleTracks.map((track) => track.id)));

        await renderTrackOffline(target, 0, 4);

        expect(mocks.renderTrackSubgraphOffline.mock.calls[0]?.[0].renderTracks).toEqual([target]);
    });

    it.each(['audio', 'midi', 'bus', 'master', 'folder'] satisfies Track['kind'][])(
        'keeps an upstream %s routing endpoint in the render subgraph',
        async (kind) => {
            const target = TrackDummy.create({ id: 'ordinary-target', kind: 'audio' });
            const upstream = TrackDummy.create({ id: `upstream-${kind}`, kind, outputId: target.id });
            mocks.trackStore.value = {
                tracks: [target, upstream],
                selectedTrackId: target.id,
                ghostClips: [],
            };
            mocks.getUpstreamSubgraph.mockReturnValue(new Set([upstream.id]));

            await renderTrackOffline(target, 0, 4);

            expect(mocks.renderTrackSubgraphOffline.mock.calls[0]?.[0].renderTracks.map((track) => track.id)).toEqual([
                target.id,
                upstream.id,
            ]);
        }
    );

    it('renders the target region through the real instrument graph with the bounce options applied', async () => {
        const track = TrackDummy.create({
            id: 'track-midi',
            kind: 'midi',
            clips: [ClipDummy.create({ id: 'clip-1', trackId: 'track-midi', type: 'midi' })],
        });
        mocks.trackStore.value = { tracks: [track], selectedTrackId: track.id, ghostClips: [] };
        const abortSignal = new AbortController().signal;
        const onProgress = vi.fn();

        await renderTrackOffline(track, 2, 6, {
            includeInserts: false,
            includeSends: false,
            includeAutomation: false,
            abortSignal,
            onProgress,
        });

        expect(mocks.renderTrackSubgraphOffline).toHaveBeenCalledWith({
            targetTrackId: 'track-midi',
            renderTracks: [track],
            startBeat: 2,
            endBeat: 6,
            tailSeconds: 0,
            // Bounce output is finished audio: its fader and pan run once, here.
            targetMixer: 'bake',
            includeInserts: false,
            includeSends: false,
            includeAutomation: false,
            abortSignal,
            onProgress,
        });
    });

    it('asks for an auto-tail render and trims the trailing silence off it', async () => {
        const track = TrackDummy.create({ id: 'track-1', kind: 'audio' });
        mocks.trackStore.value = { tracks: [track], selectedTrackId: track.id, ghostClips: [] };
        // 0.1s safety pad at this rate is 4 samples, so a lone hit at index 1
        // keeps 5 samples of the 12-sample render.
        mocks.renderTrackSubgraphOffline.mockResolvedValue(
            createAudioBuffer([0, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 40)
        );

        const result = await renderTrackOffline(track, 0, 4, { autoTail: true });

        expect(mocks.renderTrackSubgraphOffline.mock.calls[0]?.[0].tailSeconds).toBe(10);
        expect(result?.length).toBe(5);
        expect(Array.from(result!.getChannelData(0))).toEqual([0, 0.5, 0, 0, 0]);
    });

    it('applies full normalization to the rendered buffer', async () => {
        const track = TrackDummy.create({ id: 'track-1', kind: 'audio' });
        mocks.trackStore.value = { tracks: [track], selectedTrackId: track.id, ghostClips: [] };
        mocks.renderTrackSubgraphOffline.mockResolvedValue(createAudioBuffer([0.5, -0.25]));

        const result = await renderTrackOffline(track, 0, 4, { normalization: 'full' });

        // Peak 0.5 is scaled to -0.1 dB (0.99), other samples proportionally.
        expect(result?.getChannelData(0)[0]).toBeCloseTo(0.99, 5);
        expect(result?.getChannelData(0)[1]).toBeCloseTo(-0.495, 5);
    });

    it('returns the buffer untouched when protection normalization sees a safe peak', async () => {
        const raw = createAudioBuffer([0.5]);
        const track = TrackDummy.create({ id: 'track-1', kind: 'audio' });
        mocks.trackStore.value = { tracks: [track], selectedTrackId: track.id, ghostClips: [] };
        mocks.renderTrackSubgraphOffline.mockResolvedValue(raw);

        const result = await renderTrackOffline(track, 0, 4, { normalization: 'protection' });

        expect(result).toBe(raw);
    });

    it('returns null when the render graph produces no buffer', async () => {
        const track = TrackDummy.create({ id: 'track-1', kind: 'audio' });
        mocks.trackStore.value = { tracks: [track], selectedTrackId: track.id, ghostClips: [] };
        mocks.renderTrackSubgraphOffline.mockResolvedValue(null);

        const result = await renderTrackOffline(track, 0, 4, { normalization: 'full' });

        expect(result).toBeNull();
    });

    it('propagates a render abort to the caller', async () => {
        const track = TrackDummy.create({ id: 'track-1', kind: 'audio' });
        mocks.trackStore.value = { tracks: [track], selectedTrackId: track.id, ghostClips: [] };
        mocks.renderTrackSubgraphOffline.mockRejectedValue(new Error('Render aborted'));

        await expect(renderTrackOffline(track, 0, 4)).rejects.toThrow('Render aborted');
    });

    it('prepends the target when it is absent from the project tracks', async () => {
        const target = TrackDummy.create({ id: 'lonely-target', kind: 'audio' });
        // Store holds unrelated tracks; the target is provided only as the call argument.
        const other = TrackDummy.create({ id: 'other', kind: 'audio' });
        mocks.trackStore.value = { tracks: [other], selectedTrackId: other.id, ghostClips: [] };
        mocks.getUpstreamSubgraph.mockReturnValue(new Set<string>());

        await renderTrackOffline(target, 0, 4);

        expect(mocks.renderTrackSubgraphOffline.mock.calls[0]?.[0].renderTracks.map((track) => track.id)).toEqual([
            'lonely-target',
        ]);
    });

    it('returns the auto-tail buffer untouched when there is no trailing silence to trim', async () => {
        const track = TrackDummy.create({ id: 'track-1', kind: 'audio' });
        mocks.trackStore.value = { tracks: [track], selectedTrackId: track.id, ghostClips: [] };
        // A buffer whose last sample is active stays full-length: finalLength === length.
        const fullBuffer = createAudioBuffer([0.5, 0.4, 0.3], 40);
        mocks.renderTrackSubgraphOffline.mockResolvedValue(fullBuffer);

        const result = await renderTrackOffline(track, 0, 4, { autoTail: true });

        expect(result).toBe(fullBuffer);
        expect(result?.length).toBe(3);
    });

    it('returns the buffer untouched when full normalization sees an all-silent render', async () => {
        const track = TrackDummy.create({ id: 'track-1', kind: 'audio' });
        mocks.trackStore.value = { tracks: [track], selectedTrackId: track.id, ghostClips: [] };
        const silent = createAudioBuffer([0, 0, 0]);
        mocks.renderTrackSubgraphOffline.mockResolvedValue(silent);

        const result = await renderTrackOffline(track, 0, 4, { normalization: 'full' });

        expect(result).toBe(silent);
    });

    it('scales a clipping peak down to the protection target', async () => {
        const track = TrackDummy.create({ id: 'track-1', kind: 'audio' });
        mocks.trackStore.value = { tracks: [track], selectedTrackId: track.id, ghostClips: [] };
        mocks.renderTrackSubgraphOffline.mockResolvedValue(createAudioBuffer([1.2]));

        const result = await renderTrackOffline(track, 0, 4, { normalization: 'protection' });

        // Peak 1.2 scaled to -0.2 dB (0.98): 0.98 / 1.2 = 0.81666...
        expect(result?.getChannelData(0)[0]).toBeCloseTo(0.98, 5);
    });

    it('includes an upstream non-target routing endpoint via the subgraph membership branch', async () => {
        const target = TrackDummy.create({ id: 'target', kind: 'audio' });
        const upstream = TrackDummy.create({ id: 'upstream', kind: 'audio', outputId: target.id });
        mocks.trackStore.value = { tracks: [upstream, target], selectedTrackId: target.id, ghostClips: [] };
        // upstream is not the target, but belongs to the subgraph via upstreamIds.
        mocks.getUpstreamSubgraph.mockReturnValue(new Set([upstream.id]));

        await renderTrackOffline(target, 0, 4);

        expect(mocks.renderTrackSubgraphOffline.mock.calls[0]?.[0].renderTracks.map((track) => track.id)).toEqual([
            'upstream',
            'target',
        ]);
    });
});
