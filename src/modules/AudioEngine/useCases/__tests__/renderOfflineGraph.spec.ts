import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { type Track, type TrackStoreState } from '#/modules/Arrangement/stores';
import { LEGACY_MIDI_PROBABILITY_SEED, type MidiStoreState } from '#/modules/MIDI/stores';
import { type TransportState } from '#/modules/Transport/stores';

import { type DeviceNodeEntry } from '../buildDeviceChain';
import { MAX_OFFLINE_FRAMES } from '../offlineRender/constants';
import { type OfflineRenderContext } from '../offlineRender/resolveRenderContext';
import { type OfflineTrackStrip } from '../offlineRender/types';
import { renderOffline } from '../renderOffline';

// Local, field-identical replica of Arrangement's TrackDummy fixture — foreign
// test fixtures have no compliant cross-module path (models are not re-exported).
const TrackDummy = {
    create: (overrides?: Partial<Track>): Track => ({
        id: 'track-1',
        name: 'Track 1',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
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
    }),
};

const emptyMidi: NonNullable<MidiStoreState> = {
    probabilitySeed: LEGACY_MIDI_PROBABILITY_SEED,
    notesByClipId: {},
    ccByClipId: {},
    pitchBendByClipId: {},
};

type ScheduleTrackClipsInput = {
    track: Track;
    sendAutomationParams?: ReadonlyMap<string, AudioParam>;
};

const mocks = vi.hoisted(() => ({
    sidechainStore: { value: { routes: [] as Array<Record<string, unknown>> } },
    addWorkletModule: vi.fn<() => Promise<void>>(),
    resolveRenderContext: vi.fn(),
    createOfflineTrackStrip: vi.fn(),
    scheduleTrackClips: vi.fn<(input: ScheduleTrackClipsInput) => Promise<void>>(() => Promise.resolve()),
    schedulePendingSuspends: vi.fn(),
    renderWithTimeout: vi.fn(),
    /**
     * Which command kind, if any, makes the backend refuse the batch carrying
     * it. `null` leaves the real backend entirely alone.
     *
     * The refusals the contract defines — a schema mismatch, a stale
     * correlation, an unimplemented command — are all unreachable through
     * `renderOffline` today, because it issues a literal `schemaVersion`, no
     * correlation, and only supported commands. That makes them exactly the
     * kind of guard that rots: the code assuming a batch always applies sits
     * three lines from the code that guarantees it. This injects the refusal
     * the seam already models so the assumption is tested rather than trusted.
     */
    refusedCommandKind: null as string | null,
}));

vi.mock('#/modules/Routing/stores', () => ({
    sidechainStore: mocks.sidechainStore,
}));
vi.mock('../offlineRender/createWebAudioOfflineBackend', async (importOriginal) => {
    const original = await importOriginal<typeof import('../offlineRender/createWebAudioOfflineBackend')>();
    return {
        ...original,
        createWebAudioOfflineBackend: (
            deps: Parameters<typeof original.createWebAudioOfflineBackend>[0]
        ): ReturnType<typeof original.createWebAudioOfflineBackend> => {
            const backend = original.createWebAudioOfflineBackend(deps);
            return {
                ...backend,
                apply: (batch) => {
                    const refused = mocks.refusedCommandKind;
                    if (refused && batch.commands.some((command) => command.kind === refused)) {
                        return Promise.resolve({
                            acceptance: 'rejected',
                            application: 'not-applied',
                            reason: `injected refusal of "${refused}"`,
                        });
                    }
                    return backend.apply(batch);
                },
            };
        },
    };
});
vi.mock('../offlineRender/resolveRenderContext', () => ({
    resolveRenderContext: mocks.resolveRenderContext,
}));
vi.mock('../offlineRender/createOfflineTrackStrip', () => ({
    createOfflineTrackStrip: mocks.createOfflineTrackStrip,
}));
vi.mock('../offlineRender/scheduleTrackClips', () => ({
    scheduleTrackClips: mocks.scheduleTrackClips,
}));
vi.mock('../offlineRender/schedulePendingSuspends', () => ({
    schedulePendingSuspends: mocks.schedulePendingSuspends,
}));
vi.mock('../offlineRender/renderWithTimeout', () => ({
    renderWithTimeout: mocks.renderWithTimeout,
}));

type FakeGain = {
    gain: { value: number };
    connect: ReturnType<typeof vi.fn>;
};

type FakeDelay = {
    delayTime: { value: number };
    connect: ReturnType<typeof vi.fn>;
};

const createdContexts: Array<{
    channels: number;
    frames: number;
    sampleRate: number;
    gains: FakeGain[];
    delays: FakeDelay[];
    destination: object;
    audioWorklet: { addModule: ReturnType<typeof vi.fn> };
}> = [];

class FakeOfflineAudioContext {
    gains: FakeGain[] = [];
    delays: FakeDelay[] = [];
    destination = {};
    audioWorklet = { addModule: mocks.addWorkletModule };

    constructor(channels: number, frames: number, sampleRate: number) {
        createdContexts.push({
            channels,
            frames,
            sampleRate,
            gains: this.gains,
            delays: this.delays,
            destination: this.destination,
            audioWorklet: this.audioWorklet,
        });
    }

    createGain(): FakeGain {
        const gain: FakeGain = { gain: { value: 1 }, connect: vi.fn() };
        this.gains.push(gain);
        return gain;
    }

    createDelay(): FakeDelay {
        const delay: FakeDelay = { delayTime: { value: 0 }, connect: vi.fn() };
        this.delays.push(delay);
        return delay;
    }
}

function makeStrip(trackId = 'track-1'): OfflineTrackStrip {
    const makeNode = () => ({ connect: vi.fn(), gain: { value: 1 } });
    return {
        trackId,
        inputNode: makeNode() as unknown as GainNode,
        preFaderTap: makeNode() as unknown as GainNode,
        faderNode: makeNode() as unknown as GainNode,
        postFaderGain: makeNode() as unknown as GainNode,
        panNode: { connect: vi.fn(), pan: { value: 0 } } as unknown as StereoPannerNode,
        outputNode: makeNode() as unknown as GainNode,
        deviceEntries: [],
    };
}

function makeContext(overrides?: Partial<OfflineRenderContext>): OfflineRenderContext {
    return {
        tracks: { tracks: [] } as unknown as TrackStoreState,
        midi: emptyMidi,
        transport: { masterGain: 50 } as TransportState,
        defaultTempo: 120,
        changes: [],
        startBeat: 0,
        durationSeconds: 2,
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
        ...overrides,
    };
}

const renderedBuffer = { length: 42 } as unknown as AudioBuffer;

describe('renderOffline — graph construction and lifecycle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        createdContexts.length = 0;
        vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);
        mocks.sidechainStore.value.routes = [];
        mocks.refusedCommandKind = null;
        mocks.addWorkletModule.mockResolvedValue();
        mocks.resolveRenderContext.mockReturnValue(makeContext());
        mocks.createOfflineTrackStrip.mockImplementation((_ctx: OfflineAudioContext, track: { id: string }) =>
            Promise.resolve(makeStrip(track.id))
        );
        mocks.renderWithTimeout.mockResolvedValue(renderedBuffer);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('rejects a non-finite duration with an export error before resolving any project state', async () => {
        await expect(renderOffline(Number.NaN)).rejects.toThrow(/Invalid export duration/);
        expect(mocks.resolveRenderContext).not.toHaveBeenCalled();
    });

    it('creates a stereo context sized from duration and sample rate and applies the project master gain', async () => {
        mocks.resolveRenderContext.mockReturnValue(makeContext({ durationSeconds: 2 }));

        const buffer = await renderOffline({ durationBeats: 4, sampleRate: 48_000 });

        expect(buffer).toBe(renderedBuffer);
        expect(createdContexts).toHaveLength(1);
        expect(createdContexts[0]!.channels).toBe(2);
        expect(createdContexts[0]!.frames).toBe(96_000);
        expect(createdContexts[0]!.sampleRate).toBe(48_000);
        // masterGain is the first gain created; project masterGain 50/100 → 0.5.
        const masterGain = createdContexts[0]!.gains[0]!;
        expect(masterGain.gain.value).toBe(0.5);
        expect(masterGain.connect).toHaveBeenCalledWith(createdContexts[0]!.destination);
    });

    it('clamps the frame count to the browser-safe maximum for absurd durations', async () => {
        mocks.resolveRenderContext.mockReturnValue(makeContext({ durationSeconds: 10 ** 9 }));

        await renderOffline({ durationBeats: 4, sampleRate: 48_000 });

        expect(createdContexts[0]!.frames).toBe(MAX_OFFLINE_FRAMES);
    });

    it('clamps an out-of-range project master gain into 0..1 and defaults to 80% when transport is missing', async () => {
        mocks.resolveRenderContext.mockReturnValue(makeContext({ transport: { masterGain: 150 } as TransportState }));
        await renderOffline(4);
        expect(createdContexts[0]!.gains[0]!.gain.value).toBe(1);

        mocks.resolveRenderContext.mockReturnValue(makeContext({ transport: null }));
        await renderOffline(4);
        expect(createdContexts[1]!.gains[0]!.gain.value).toBeCloseTo(0.8, 6);
    });

    it('routes strips to master, buses, other track inputs, or master fallback by outputId', async () => {
        const hwTrack = TrackDummy.create({ id: 't-hw', outputId: 'hw_out' });
        const busTrack = TrackDummy.create({
            id: 'bus-1',
            kind: 'bus',
            gain: 0.9,
            outputId: 'hw_out',
            devices: [{ id: 'return-fx' } as never],
        });
        const toBusTrack = TrackDummy.create({ id: 't-bus', outputId: 'bus-1' });
        const toTrackTrack = TrackDummy.create({ id: 't-chain', outputId: 't-hw' });
        const orphanTrack = TrackDummy.create({ id: 't-orphan', outputId: 'ghost' });
        mocks.resolveRenderContext.mockReturnValue(
            makeContext({
                tracks: {
                    tracks: [hwTrack, busTrack, toBusTrack, toTrackTrack, orphanTrack],
                } as unknown as TrackStoreState,
            })
        );
        const stripsByTrack = new Map<string, OfflineTrackStrip>();
        mocks.createOfflineTrackStrip.mockImplementation((_ctx: OfflineAudioContext, track: Track) => {
            const strip = makeStrip(track.id);
            stripsByTrack.set(track.id, strip);
            return Promise.resolve(strip);
        });

        await renderOffline(4);

        const masterGain = createdContexts[0]!.gains[0]!;

        expect(stripsByTrack.get('t-hw')!.outputNode.connect).toHaveBeenCalledWith(masterGain);
        expect(stripsByTrack.get('bus-1')!.outputNode.connect).toHaveBeenCalledWith(masterGain);
        expect(stripsByTrack.get('t-bus')!.outputNode.connect).toHaveBeenCalledWith(
            stripsByTrack.get('bus-1')!.inputNode
        );
        expect(stripsByTrack.get('t-chain')!.outputNode.connect).toHaveBeenCalledWith(
            stripsByTrack.get('t-hw')!.inputNode
        );
        expect(stripsByTrack.get('t-orphan')!.outputNode.connect).toHaveBeenCalledWith(masterGain);
    });

    it('routes a Toaster pad into its child strip and removes the duplicate parent dry copy', async () => {
        const parent = TrackDummy.create({
            id: 'toaster-parent',
            kind: 'folder',
            devices: [{ id: 'toaster-device', type: 'toaster' } as never],
        });
        const child = TrackDummy.create({ id: 'pad-child', kind: 'midi', parentId: parent.id, outputId: parent.id });
        const connectPadOutput = vi.fn<NonNullable<DeviceNodeEntry['strategy']['connectPadOutput']>>();
        const setPadDryRouted = vi.fn<NonNullable<DeviceNodeEntry['strategy']['setPadDryRouted']>>();
        const stripsByTrack = new Map<string, OfflineTrackStrip>();
        mocks.resolveRenderContext.mockReturnValue(
            makeContext({ tracks: { tracks: [parent, child] } as unknown as TrackStoreState })
        );
        mocks.createOfflineTrackStrip.mockImplementation((_ctx: OfflineAudioContext, track: Track) => {
            const strip = makeStrip(track.id);
            if (track.id === parent.id) {
                const audioNode = {} as AudioNode;
                const node: DeviceNodeEntry['node'] = {
                    inputNode: audioNode,
                    outputNode: audioNode,
                    nodes: [audioNode],
                };
                strip.deviceEntries = [
                    {
                        deviceId: 'toaster-device',
                        deviceType: 'toaster',
                        node,
                        strategy: {
                            node,
                            acceptsNotes: true,
                            setParam: vi.fn<(name: string, value: number) => void>(),
                            resolveOfflineAutomation: () => null,
                            connectPadOutput,
                            setPadDryRouted,
                        },
                    },
                ];
            }
            stripsByTrack.set(track.id, strip);
            return Promise.resolve(strip);
        });

        await renderOffline(4);

        expect(connectPadOutput).toHaveBeenCalledWith(0, stripsByTrack.get(child.id)!.inputNode);
        expect(setPadDryRouted).toHaveBeenCalledWith(0, true);
        expect(stripsByTrack.get(child.id)!.outputNode.connect).toHaveBeenCalledWith(
            stripsByTrack.get(parent.id)!.inputNode
        );
    });

    it('loads and wires a persisted sidechain route into compressor input one', async () => {
        const kick = TrackDummy.create({ id: 'kick' });
        const compressorDevice = {
            id: 'compressor-1',
            type: 'builtin-sidechain-compressor',
            bypassed: false,
        } as never;
        const bass = TrackDummy.create({ id: 'bass', devices: [compressorDevice] });
        const stripsByTrack = new Map<string, OfflineTrackStrip>();
        const sidechainInput = { numberOfInputs: 2 } as AudioNode;
        mocks.sidechainStore.value.routes = [
            {
                id: 'route-1',
                sourceTrackId: kick.id,
                targetTrackId: bass.id,
                targetDeviceId: 'compressor-1',
                targetParameterId: 'sc-comp-threshold',
                gain: 0.6,
            },
        ];
        mocks.resolveRenderContext.mockReturnValue(
            makeContext({ tracks: { tracks: [kick, bass] } as unknown as TrackStoreState })
        );
        mocks.createOfflineTrackStrip.mockImplementation((_ctx: OfflineAudioContext, track: Track) => {
            const strip = makeStrip(track.id);
            if (track.id === bass.id) {
                const node: DeviceNodeEntry['node'] = {
                    inputNode: sidechainInput,
                    outputNode: sidechainInput,
                    nodes: [sidechainInput],
                };
                strip.deviceEntries = [
                    {
                        deviceId: 'compressor-1',
                        deviceType: 'builtin-sidechain-compressor',
                        node,
                        strategy: {
                            node,
                            acceptsNotes: false,
                            setParam: vi.fn<(name: string, value: number) => void>(),
                            resolveOfflineAutomation: () => null,
                        },
                    },
                ];
            }
            stripsByTrack.set(track.id, strip);
            return Promise.resolve(strip);
        });

        await renderOffline(4);

        expect(createdContexts[0]!.audioWorklet.addModule).toHaveBeenCalledWith(
            '/audio/worklets/sidechain-compressor-processor.js'
        );
        const routeGain = createdContexts[0]!.gains[1]!;
        expect(routeGain.gain.value).toBe(1);
        // FX-5 — the key runs source → alignment delay → route gain → detector
        // input, so the source tap feeds the delay, not the gain directly.
        const keyDelay = createdContexts[0]!.delays[0]!;
        expect(stripsByTrack.get(kick.id)!.outputNode.connect).toHaveBeenCalledWith(keyDelay);
        expect(keyDelay.connect).toHaveBeenCalledWith(routeGain);
        expect(routeGain.connect).toHaveBeenCalledWith(sidechainInput, 0, 1);
    });

    it('wires a persisted sidechain key into the compressor input exactly once (no double-wire)', async () => {
        const kick = TrackDummy.create({ id: 'kick' });
        const bass = TrackDummy.create({
            id: 'bass',
            devices: [{ id: 'compressor-1', type: 'builtin-sidechain-compressor', bypassed: false } as never],
        });
        const sidechainInput = { numberOfInputs: 2 } as AudioNode;
        mocks.sidechainStore.value.routes = [
            {
                id: 'route-1',
                sourceTrackId: kick.id,
                targetTrackId: bass.id,
                targetDeviceId: 'compressor-1',
                targetParameterId: 'sc-comp-threshold',
                gain: 1,
            },
        ];
        mocks.resolveRenderContext.mockReturnValue(
            makeContext({ tracks: { tracks: [kick, bass] } as unknown as TrackStoreState })
        );
        mocks.createOfflineTrackStrip.mockImplementation((_ctx: OfflineAudioContext, track: Track) => {
            const strip = makeStrip(track.id);
            if (track.id === bass.id) {
                const node: DeviceNodeEntry['node'] = {
                    inputNode: sidechainInput,
                    outputNode: sidechainInput,
                    nodes: [sidechainInput],
                };
                strip.deviceEntries = [
                    {
                        deviceId: 'compressor-1',
                        deviceType: 'builtin-sidechain-compressor',
                        node,
                        strategy: {
                            node,
                            acceptsNotes: false,
                            setParam: vi.fn<(name: string, value: number) => void>(),
                            resolveOfflineAutomation: () => null,
                        },
                    },
                ];
            }
            return Promise.resolve(strip);
        });

        await renderOffline(4);

        // Web Audio sums parallel edges: a second key wire over the same route
        // would ~double the sidechain key amplitude (~+6 dB) and over-duck every
        // sidechained mixdown. Exactly one gain must feed the compressor's key
        // input (index 1).
        const keyEdges = createdContexts[0]!.gains.filter((gain) =>
            gain.connect.mock.calls.some((call) => call[0] === sidechainInput && call[1] === 0 && call[2] === 1)
        );
        expect(keyEdges).toHaveLength(1);
    });

    it('warns and retains the compressor fallback when sidechain worklet preparation fails', async () => {
        const kick = TrackDummy.create({ id: 'kick' });
        const bass = TrackDummy.create({
            id: 'bass',
            devices: [{ id: 'compressor-1', type: 'builtin-sidechain-compressor', bypassed: false } as never],
        });
        mocks.sidechainStore.value.routes = [
            {
                id: 'route-1',
                sourceTrackId: kick.id,
                targetTrackId: bass.id,
                targetDeviceId: 'compressor-1',
                targetParameterId: 'sc-comp-threshold',
                gain: 1,
            },
        ];
        mocks.resolveRenderContext.mockReturnValue(
            makeContext({ tracks: { tracks: [kick, bass] } as unknown as TrackStoreState })
        );
        mocks.addWorkletModule.mockRejectedValueOnce(new Error('worklets blocked'));
        const onWarning = vi.fn();

        await expect(renderOffline({ durationBeats: 4, onWarning })).resolves.toBe(renderedBuffer);

        expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('worklets blocked'));
    });

    it('does not prepare the sidechain worklet without a valid persisted route', async () => {
        const bass = TrackDummy.create({
            id: 'bass',
            devices: [{ id: 'compressor-1', type: 'builtin-sidechain-compressor', bypassed: false } as never],
        });
        mocks.resolveRenderContext.mockReturnValue(
            makeContext({ tracks: { tracks: [bass] } as unknown as TrackStoreState })
        );

        await renderOffline(4);

        expect(mocks.addWorkletModule).not.toHaveBeenCalled();
    });

    it('wires sends from the right tap with a clamped level and drops sends to unknown buses', async () => {
        const deviceBusTrack = TrackDummy.create({
            id: 'device-bus',
            kind: 'bus',
            devices: [{ id: 'return-fx' } as never],
        });
        const ordinaryBusTrack = TrackDummy.create({ id: 'ordinary-bus', kind: 'bus' });
        const sender = TrackDummy.create({
            id: 't-send',
            sends: [
                { busId: 'device-bus', level: 2, preFader: true },
                { busId: 'ordinary-bus', level: 0.4, preFader: false },
                { busId: 'missing-bus', level: 1, preFader: false },
            ] as Track['sends'],
        });
        mocks.resolveRenderContext.mockReturnValue(
            makeContext({
                tracks: { tracks: [deviceBusTrack, ordinaryBusTrack, sender] } as unknown as TrackStoreState,
            })
        );
        const stripsByTrack = new Map<string, OfflineTrackStrip>();
        mocks.createOfflineTrackStrip.mockImplementation((_ctx: OfflineAudioContext, track: Track) => {
            const strip = makeStrip(track.id);
            stripsByTrack.set(track.id, strip);
            return Promise.resolve(strip);
        });

        await renderOffline(4);

        const senderStrip = stripsByTrack.get('t-send')!;
        // Two send gains created (unknown bus creates none): master, send, send.
        expect(createdContexts[0]!.gains).toHaveLength(3);
        const preFaderSendGain = createdContexts[0]!.gains[1]!;
        const postFaderSendGain = createdContexts[0]!.gains[2]!;

        expect(preFaderSendGain.gain.value).toBe(1); // clamped from 2
        expect(senderStrip.preFaderTap.connect).toHaveBeenCalledWith(preFaderSendGain);
        expect(preFaderSendGain.connect).toHaveBeenCalledWith(stripsByTrack.get('device-bus')!.inputNode);

        expect(postFaderSendGain.gain.value).toBe(0.4);
        expect(senderStrip.outputNode.connect).toHaveBeenCalledWith(postFaderSendGain);
        expect(postFaderSendGain.connect).toHaveBeenCalledWith(stripsByTrack.get('ordinary-bus')!.inputNode);

        const senderSchedule = mocks.scheduleTrackClips.mock.calls.find(([input]) => input.track.id === sender.id)?.[0];
        expect(senderSchedule?.sendAutomationParams?.get('send:device-bus')).toBe(preFaderSendGain.gain);
        expect(senderSchedule?.sendAutomationParams?.get('send:ordinary-bus')).toBe(postFaderSendGain.gain);
        expect(senderSchedule?.sendAutomationParams?.has('send:missing-bus')).toBe(false);
    });

    it('builds strips for muted tracks to keep routing alive but never schedules their clips', async () => {
        const audible = TrackDummy.create({ id: 't-live' });
        const muted = TrackDummy.create({ id: 't-muted', muted: true });
        const disabled = TrackDummy.create({ id: 't-disabled', disabled: true });
        mocks.resolveRenderContext.mockReturnValue(
            makeContext({ tracks: { tracks: [audible, muted, disabled] } as unknown as TrackStoreState })
        );

        await renderOffline(4);

        // Disabled tracks get no strip at all; muted tracks get one.
        expect(mocks.createOfflineTrackStrip).toHaveBeenCalledTimes(2);
        expect(mocks.scheduleTrackClips).toHaveBeenCalledTimes(1);
        const scheduledTrack = mocks.scheduleTrackClips.mock.calls[0]![0].track;
        expect(scheduledTrack.id).toBe('t-live');
        expect(mocks.schedulePendingSuspends).toHaveBeenCalledTimes(1);
    });

    it('fails the export when the backend refuses to build a strip, rather than dropping the track', async () => {
        const track = TrackDummy.create({ id: 't-a' });
        mocks.resolveRenderContext.mockReturnValue(
            makeContext({ tracks: { tracks: [track] } as unknown as TrackStoreState })
        );
        mocks.refusedCommandKind = 'create-track-strip';

        // The alternative is what this guards against: no strip, `continue`,
        // and a file silently missing a track the user can hear is gone only
        // by listening to it.
        await expect(renderOffline(4)).rejects.toThrow(/refused to build the strip/);
        expect(mocks.renderWithTimeout).not.toHaveBeenCalled();
    });

    it('fails the export when the backend refuses to route a strip, rather than rendering it silent', async () => {
        const track = TrackDummy.create({ id: 't-a' });
        mocks.resolveRenderContext.mockReturnValue(
            makeContext({ tracks: { tracks: [track] } as unknown as TrackStoreState })
        );
        mocks.refusedCommandKind = 'set-track-output';

        // Worse than a missing strip: the strip exists and nothing reaches it,
        // so every downstream check still sees a well-formed graph.
        await expect(renderOffline(4)).rejects.toThrow(/refused to route the output and sends/);
        expect(mocks.renderWithTimeout).not.toHaveBeenCalled();
    });

    it('reports scheduling progress up to 50% and completion at 100%', async () => {
        const trackA = TrackDummy.create({ id: 't-a' });
        const trackB = TrackDummy.create({ id: 't-b' });
        mocks.resolveRenderContext.mockReturnValue(
            makeContext({ tracks: { tracks: [trackA, trackB] } as unknown as TrackStoreState })
        );
        const onProgress = vi.fn();

        await renderOffline({ durationBeats: 4, onProgress });

        expect(onProgress).toHaveBeenCalledWith(0.25);
        expect(onProgress).toHaveBeenCalledWith(0.5);
        expect(onProgress).toHaveBeenLastCalledWith(1);
    });

    it('holds the render lock while active and releases it when the render fails', async () => {
        let resolveRender: ((buffer: AudioBuffer) => void) | undefined;
        mocks.renderWithTimeout.mockImplementation(
            () =>
                new Promise<AudioBuffer>((resolve) => {
                    resolveRender = resolve;
                })
        );

        const inFlight = renderOffline(4);
        await vi.waitFor(() => expect(mocks.renderWithTimeout).toHaveBeenCalledTimes(1));

        // A second export while one is active must be refused.
        await expect(renderOffline(4)).rejects.toThrow(/already in progress/);

        resolveRender!(renderedBuffer);
        await expect(inFlight).resolves.toBe(renderedBuffer);

        // A failing render must still release the lock for the next attempt.
        mocks.renderWithTimeout.mockRejectedValueOnce(new Error('render timed out'));
        await expect(renderOffline(4)).rejects.toThrow('render timed out');

        mocks.renderWithTimeout.mockResolvedValue(renderedBuffer);
        await expect(renderOffline(4)).resolves.toBe(renderedBuffer);
    });
});
