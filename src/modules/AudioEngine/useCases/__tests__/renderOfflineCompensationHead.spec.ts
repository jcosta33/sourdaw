/**
 * An export prints its latency compensation from the head (#7312).
 *
 * Every strip of a render is held back by the compensation that aligns it to
 * the session's deepest latency, so the whole master arrives late by that
 * figure. A musician's export renders the extra as pre-roll and trims it from
 * the head: material keeps its timeline frame, the file keeps its length, and
 * nothing in the last compensation window is cut. An agent measurement keeps
 * the base span it has always rendered.
 *
 * The fixture is two strips: one carries a clip that ends 0.05 s before the
 * region end with no tail, the other a device reporting 0.25 s of latency, so
 * the clip strip is the one compensation delays.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { type Track, type TrackStoreState } from '#/modules/Arrangement/stores';
import { LEGACY_MIDI_PROBABILITY_SEED, type MidiStoreState } from '#/modules/MIDI/stores';
import { type TransportState } from '#/modules/Transport/stores';

import { withNativeTimelineMaterialTransport } from '../../repositories/nativeGraph/__tests__/withNativeTimelineMaterialTransport';
import {
    type NativeGraphTransport,
    type RenderGraphOfflineInput,
} from '../../repositories/nativeGraph/nativeGraphTransport';
import { externalLatencyRegistry } from '../latencyCompensation/compensation/externalLatencyRegistry';
import { captureOfflineRenderInput } from '../offlineRender/captureOfflineRenderInput';
import { renderOfflineInput } from '../offlineRender/renderOfflineInput';
import { type OfflineRenderContext } from '../offlineRender/resolveRenderContext';
import { type OfflineTrackStrip } from '../offlineRender/types';
import { renderOffline } from '../renderOffline';

registerDeviceEnginePorts();

const SAMPLE_RATE = 48_000;
const REGION_SECONDS = 2;
const LATENCY_SECONDS = 0.25;
const CLIP_START_SECONDS = 1;
const CLIP_END_SECONDS = 1.95;
const CLIP_LEVEL = 0.5;
const OUTPUT_FRAMES = REGION_SECONDS * SAMPLE_RATE;
const HEAD_FRAMES = LATENCY_SECONDS * SAMPLE_RATE;

const mocks = vi.hoisted(() => ({
    resolveRenderContext: vi.fn(),
    selectOfflineRenderEngine: vi.fn(),
    createOfflineTrackStrip: vi.fn(),
    buffers: new Map<string, AudioBuffer>(),
}));

vi.mock('../../stores/audioBufferCache', () => ({
    audioBufferCache: {
        get: (id: string) => mocks.buffers.get(id),
        has: (id: string) => mocks.buffers.has(id),
        readRuntimeMaterialPublication: () => undefined,
    },
}));
vi.mock('#/modules/Routing/stores', () => ({
    sidechainStore: { value: { routes: [] } },
}));
vi.mock('../offlineRender/selectOfflineRenderEngine', () => ({
    selectOfflineRenderEngine: mocks.selectOfflineRenderEngine,
}));
vi.mock('../offlineRender/resolveRenderContext', () => ({
    resolveRenderContext: mocks.resolveRenderContext,
}));
vi.mock('../offlineRender/createOfflineTrackStrip', () => ({
    createOfflineTrackStrip: mocks.createOfflineTrackStrip,
}));

class SnapshotAudioBuffer {
    readonly channels: Float32Array[];
    readonly length: number;
    readonly numberOfChannels: number;
    readonly sampleRate: number;
    readonly duration: number;
    constructor(options: { length: number; numberOfChannels: number; sampleRate: number }) {
        this.length = options.length;
        this.numberOfChannels = options.numberOfChannels;
        this.sampleRate = options.sampleRate;
        this.duration = options.length / options.sampleRate;
        this.channels = Array.from({ length: options.numberOfChannels }, () => new Float32Array(options.length));
    }
    getChannelData(channel: number) {
        return this.channels[channel]!;
    }
    copyToChannel(data: Float32Array, channel: number) {
        this.getChannelData(channel).set(data);
    }
}

function makeParam() {
    return {
        value: 1,
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
        setTargetAtTime: vi.fn(),
    };
}

type StartedSource = { buffer: AudioBuffer | null; when: number; offset: number; duration: number };

const createdContextFrames: number[] = [];

/**
 * Prints every started source onto its master at the frame it was started on,
 * which is all this fixture's strips do: the clip strip carries no device, and
 * the latent strip plays nothing.
 */
class PrintingOfflineAudioContext {
    readonly destination = {};
    readonly audioWorklet = { addModule: vi.fn(() => Promise.resolve()) };
    readonly sampleRate: number;
    readonly currentTime = 0;
    private readonly frames: number;
    private readonly started: StartedSource[] = [];

    constructor(_channels: number, frames: number, sampleRate: number) {
        this.frames = frames;
        this.sampleRate = sampleRate;
        createdContextFrames.push(frames);
    }

    createBufferSource() {
        const source: { buffer: AudioBuffer | null } & Record<string, unknown> = {
            buffer: null,
            playbackRate: makeParam(),
            connect: vi.fn(),
            start: (when: number, offset = 0, duration = Infinity) => {
                this.started.push({ buffer: source.buffer, when, offset, duration });
            },
        };
        return source;
    }

    createGain() {
        return { gain: makeParam(), connect: vi.fn() };
    }

    createDelay() {
        return { delayTime: { value: 0 }, connect: vi.fn() };
    }

    startRendering(): Promise<AudioBuffer> {
        const output = new AudioBuffer({ length: this.frames, numberOfChannels: 2, sampleRate: this.sampleRate });
        for (const { buffer, when, offset, duration } of this.started) {
            if (!buffer) {
                continue;
            }
            const source = buffer.getChannelData(0);
            const first = Math.round(when * this.sampleRate);
            const sourceFirst = Math.round(offset * this.sampleRate);
            const count = Math.min(Math.round(duration * this.sampleRate), source.length - sourceFirst);
            for (let index = 0; index < count && first + index < this.frames; index++) {
                output.getChannelData(0)[first + index] = source[sourceFirst + index]!;
            }
        }
        return Promise.resolve(output);
    }
}

function makeStrip(trackId: string): OfflineTrackStrip {
    const makeNode = () => ({ connect: vi.fn(), gain: makeParam() });
    return {
        trackId,
        inputNode: makeNode() as unknown as GainNode,
        preFaderTap: makeNode() as unknown as GainNode,
        faderNode: makeNode() as unknown as GainNode,
        postFaderGain: makeNode() as unknown as GainNode,
        panNode: { connect: vi.fn(), pan: { ...makeParam(), value: 0 } } as unknown as StereoPannerNode,
        outputNode: makeNode() as unknown as GainNode,
        deviceEntries: [],
    };
}

function makeTrack(overrides: Partial<Track> & Pick<Track, 'id'>): Track {
    return {
        name: overrides.id,
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'hw_out',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        midiFx: [],
        ...overrides,
    };
}

const emptyMidi: NonNullable<MidiStoreState> = {
    probabilitySeed: LEGACY_MIDI_PROBABILITY_SEED,
    notesByClipId: {},
    ccByClipId: {},
    pitchBendByClipId: {},
};

/** One beat is one second, so a clip's beats are its timeline seconds. */
function makeContext(tracks: readonly Track[]): OfflineRenderContext {
    return {
        tracks: { tracks } as unknown as TrackStoreState,
        midi: emptyMidi,
        transport: { masterGain: 100 } as TransportState,
        defaultTempo: 60,
        changes: [],
        startBeat: 0,
        durationSeconds: REGION_SECONDS,
        tailSeconds: 0,
        projectMidiEvents: ({ events }) => events,
        selectMidiEventProbability: () => true,
        projectChordPitch: ({ pitch }) => pitch,
        projectPpqEndpoints: ({ startPpq, endPpq, sampleRate }) => ({
            startSamples: startPpq * sampleRate,
            endSamples: endPpq * sampleRate,
            durationSamples: (endPpq - startPpq) * sampleRate,
            startSeconds: startPpq,
            endSeconds: endPpq,
            durationSeconds: endPpq - startPpq,
        }),
        processYeastMidi: null,
        resolveTempoAtBeat: ({ defaultTempo: tempo }) => tempo,
        evaluateAutomationValue: null,
    };
}

function fixtureTracks(): Track[] {
    const clipTrack = makeTrack({
        id: 'clip-track',
        clips: [
            {
                id: 'clip',
                trackId: 'clip-track',
                name: 'Hit',
                type: 'audio',
                startBeat: CLIP_START_SECONDS,
                endBeat: CLIP_END_SECONDS,
                audioBufferId: 'pcm',
                gain: 1,
                color: '#fff',
                locked: false,
                muted: false,
                fadeInBeats: 0,
                fadeOutBeats: 0,
            },
        ],
    });
    // Knead has no engine-side compensation, so both engines hold the clip
    // strip back by the full reported figure through the programme.
    const latentTrack = makeTrack({
        id: 'latent-track',
        devices: [{ id: 'latent-device', name: 'Latent', type: 'knead', bypassed: false, parameterValues: {} }],
    });
    return [clipTrack, latentTrack];
}

/** The first and last frame carrying the clip's level, or `null` for a silent render. */
function soundingSpan(buffer: Pick<AudioBuffer, 'getChannelData'>): { first: number; last: number } | null {
    const samples = buffer.getChannelData(0);
    const first = samples.findIndex((sample) => sample === CLIP_LEVEL);
    if (first < 0) {
        return null;
    }
    return { first, last: samples.findLastIndex((sample) => sample === CLIP_LEVEL) };
}

/**
 * A native engine double that prints each scheduled clip at the frame its
 * programme start names, in the frames it was asked for. That is what the
 * engine returns once it has rendered its own compensation depth ahead and
 * dropped it: this fixture's strips declare nothing the engine holds itself.
 */
function printingNativeTransport(requests: RenderGraphOfflineInput[]): NativeGraphTransport {
    const unexpected = () => Promise.reject(new Error('Unexpected native operation'));
    return withNativeTimelineMaterialTransport({
        registerTimelineSample: () => Promise.resolve(),
        beginLevainBank: unexpected,
        registerLevainSample: unexpected,
        commitLevainBank: unexpected,
        releaseLevainBank: unexpected,
        applyGraphCommands: unexpected,
        mapGraphBatch: () => Promise.resolve({ acceptance: 'accepted', application: 'applied', reports: [] }),
        renderGraphOffline: (input) => {
            requests.push(input);
            const interleaved = new Float32Array(input.frames * 2);
            for (const command of input.batch.commands) {
                if (command.kind !== 'schedule-clip') {
                    continue;
                }
                const first = Math.round(command.playback.startTime * SAMPLE_RATE);
                const count = Math.round(command.playback.durationSeconds * SAMPLE_RATE);
                for (let index = 0; index < count && first + index < input.frames; index++) {
                    interleaved[(first + index) * 2] = CLIP_LEVEL;
                }
            }
            return Promise.resolve(new Uint8Array(interleaved.buffer));
        },
    });
}

/**
 * A native engine double that refuses every render with `refusal`, prefixed
 * the way the desktop IPC prefixes a rejected invoke.
 */
function refusingNativeTransport(requests: RenderGraphOfflineInput[], refusal: string): NativeGraphTransport {
    const transport = printingNativeTransport(requests);
    return {
        ...transport,
        renderGraphOffline: (input) => {
            requests.push(input);
            return Promise.reject(
                new Error(`Error invoking remote method 'sourdaw:invoke:render_graph_offline': Error: ${refusal}`)
            );
        },
    };
}

const exportOptions = { durationBeats: REGION_SECONDS, sampleRate: SAMPLE_RATE, tailSeconds: 0 };

describe('an export prints its latency compensation from the head', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        createdContextFrames.length = 0;
        vi.stubGlobal('AudioBuffer', SnapshotAudioBuffer);
        vi.stubGlobal('OfflineAudioContext', PrintingOfflineAudioContext);
        const pcm = new AudioBuffer({ length: SAMPLE_RATE * 2, numberOfChannels: 1, sampleRate: SAMPLE_RATE });
        pcm.getChannelData(0).fill(CLIP_LEVEL);
        mocks.buffers.set('pcm', pcm);
        externalLatencyRegistry.set('latent-device', LATENCY_SECONDS * 1000);
        mocks.resolveRenderContext.mockReturnValue(makeContext(fixtureTracks()));
        mocks.createOfflineTrackStrip.mockImplementation((_context: OfflineAudioContext, track: { id: string }) =>
            Promise.resolve(makeStrip(track.id))
        );
        mocks.selectOfflineRenderEngine.mockResolvedValue({
            engine: 'web-audio/offline',
            reason: 'browser',
            degraded: false,
        });
    });

    afterEach(() => {
        externalLatencyRegistry.delete('latent-device');
        mocks.buffers.clear();
        vi.unstubAllGlobals();
    });

    it('keeps a compensated clip on its timeline frame and the file its length on Web Audio', async () => {
        const rendered = await renderOffline(exportOptions);

        expect(createdContextFrames).toEqual([HEAD_FRAMES + OUTPUT_FRAMES]);
        expect(rendered.length).toBe(OUTPUT_FRAMES);
        expect(soundingSpan(rendered)).toEqual({
            first: CLIP_START_SECONDS * SAMPLE_RATE,
            last: CLIP_END_SECONDS * SAMPLE_RATE - 1,
        });
    });

    it('keeps an agent measurement on its base span, compensation and all', async () => {
        const rendered = await renderOfflineInput(captureOfflineRenderInput(exportOptions), {
            lockHolder: 'agent-measurement',
        });

        expect(createdContextFrames).toEqual([OUTPUT_FRAMES]);
        expect(rendered.length).toBe(OUTPUT_FRAMES);
        expect(soundingSpan(rendered)).toEqual({
            first: (CLIP_START_SECONDS + LATENCY_SECONDS) * SAMPLE_RATE,
            last: OUTPUT_FRAMES - 1,
        });
    });

    it('asks the native engine for its programme head and trims exactly that head', async () => {
        const requests: RenderGraphOfflineInput[] = [];
        mocks.selectOfflineRenderEngine.mockResolvedValue({
            engine: 'native/offline',
            transport: printingNativeTransport(requests),
        });

        const rendered = await renderOffline(exportOptions);

        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({ frames: HEAD_FRAMES + OUTPUT_FRAMES, printsCompensationHead: true });
        expect(rendered.length).toBe(OUTPUT_FRAMES);
        expect(soundingSpan(rendered)).toEqual({
            first: CLIP_START_SECONDS * SAMPLE_RATE,
            last: CLIP_END_SECONDS * SAMPLE_RATE - 1,
        });
    });

    it('lets the native engine trim its own depth when the programme adds none', async () => {
        externalLatencyRegistry.delete('latent-device');
        const requests: RenderGraphOfflineInput[] = [];
        mocks.selectOfflineRenderEngine.mockResolvedValue({
            engine: 'native/offline',
            transport: printingNativeTransport(requests),
        });

        const rendered = await renderOffline(exportOptions);

        expect(requests[0]).toMatchObject({ frames: OUTPUT_FRAMES, printsCompensationHead: true });
        expect(rendered.length).toBe(OUTPUT_FRAMES);
        expect(soundingSpan(rendered)?.first).toBe(CLIP_START_SECONDS * SAMPLE_RATE);
    });

    it('keeps an agent section render on its base span, compensation and all', async () => {
        const rendered = await renderOfflineInput(captureOfflineRenderInput(exportOptions), {
            lockHolder: 'agent-section-render',
        });

        expect(createdContextFrames).toEqual([OUTPUT_FRAMES]);
        expect(rendered.length).toBe(OUTPUT_FRAMES);
        expect(soundingSpan(rendered)).toEqual({
            first: (CLIP_START_SECONDS + LATENCY_SECONDS) * SAMPLE_RATE,
            last: OUTPUT_FRAMES - 1,
        });
    });

    it('declines to Web Audio, warning, when the engine head takes the native print past its frame ceiling', async () => {
        const requests: RenderGraphOfflineInput[] = [];
        const warnings: string[] = [];
        mocks.selectOfflineRenderEngine.mockResolvedValue({
            engine: 'native/offline',
            transport: refusingNativeTransport(
                requests,
                'offline-render-head-past-ceiling: frame count 28800000 plus the 512-frame compensation head ' +
                    'exceeds the offline render ceiling of 28800000'
            ),
        });

        const rendered = await renderOffline({ ...exportOptions, onWarning: (message) => warnings.push(message) });

        expect(requests).toHaveLength(1);
        expect(warnings).toEqual([
            'The native engine declined this export (its printed compensation head takes it past the native ' +
                "render's frame ceiling); rendering through Web Audio.",
        ]);
        expect(createdContextFrames).toEqual([HEAD_FRAMES + OUTPUT_FRAMES]);
        expect(rendered.length).toBe(OUTPUT_FRAMES);
        expect(soundingSpan(rendered)).toEqual({
            first: CLIP_START_SECONDS * SAMPLE_RATE,
            last: CLIP_END_SECONDS * SAMPLE_RATE - 1,
        });
    });

    it('still fails a native export the engine refuses for its requested frames alone', async () => {
        const requests: RenderGraphOfflineInput[] = [];
        mocks.selectOfflineRenderEngine.mockResolvedValue({
            engine: 'native/offline',
            transport: refusingNativeTransport(
                requests,
                'Frame count 28800001 exceeds the offline render ceiling of 28800000'
            ),
        });

        await expect(renderOffline(exportOptions)).rejects.toThrow(
            'Frame count 28800001 exceeds the offline render ceiling of 28800000'
        );
        expect(createdContextFrames).toEqual([]);
    });

    it('renders an agent measurement natively from the engine head, untrimmed', async () => {
        const requests: RenderGraphOfflineInput[] = [];
        mocks.selectOfflineRenderEngine.mockResolvedValue({
            engine: 'native/offline',
            transport: printingNativeTransport(requests),
        });

        const rendered = await renderOfflineInput(captureOfflineRenderInput(exportOptions), {
            lockHolder: 'agent-measurement',
        });

        expect(requests[0]).toMatchObject({ frames: OUTPUT_FRAMES, printsCompensationHead: false });
        expect(soundingSpan(rendered)?.first).toBe((CLIP_START_SECONDS + LATENCY_SECONDS) * SAMPLE_RATE);
    });
});
