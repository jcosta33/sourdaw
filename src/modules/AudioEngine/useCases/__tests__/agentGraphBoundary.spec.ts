import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { createMockAudioContext, type MockAudioContext } from '../../../../helpers/__tests__/audioContext.mock';
import {
    createAudioEngineTopologyTestHarness,
    type AudioEngineTopologyTestHarness,
} from '../../repositories/__tests__/createAudioEngineTopologyTestHarness';
import { cachePreviewAudioBuffer } from '../cachePreviewAudioBuffer';
import { compileRuntimeGraphDelta } from '../compileRuntimeGraphDelta';
import { playCachedAudioBufferPreview } from '../playCachedAudioBufferPreview';
import { renderOffline } from '../renderOffline';

const previewSeamMocks = vi.hoisted(() => ({
    getAudioContext: vi.fn(),
    createBufferSource: vi.fn(),
    resolveRenderContext: vi.fn(),
    scheduleTrackClips: vi.fn(),
}));

// The preview cache/playback seam: both run on the live context per
// `cachePreviewAudioBuffer.ts`/`playCachedAudioBufferPreview.ts`, so this test
// controls exactly what "the live context" is without touching the app
// singleton (`audioEngine`) other tests in this file construct directly.
vi.mock('../engineAccess/getAudioContext', () => ({
    getAudioContext: previewSeamMocks.getAudioContext,
}));
vi.mock('../scheduling/createBufferSource', () => ({
    createBufferSource: previewSeamMocks.createBufferSource,
}));
vi.mock('../offlineRender/resolveRenderContext', () => ({
    resolveRenderContext: previewSeamMocks.resolveRenderContext,
}));
// Clip/note scheduling is exercised by `renderOffline.spec.ts`; this file only
// needs the strip-building loop to run for real, so the clip seam stays a
// no-op exactly as it does there.
vi.mock('../offlineRender/scheduleTrackClips', () => ({
    scheduleTrackClips: previewSeamMocks.scheduleTrackClips,
}));

const previewBufferStore = new Map<string, unknown>();
vi.mock('../../stores/audioBufferCache', () => ({
    audioBufferCache: {
        get: (id: string) => previewBufferStore.get(id),
        set: (id: string, buffer: unknown) => {
            previewBufferStore.set(id, buffer);
        },
    },
}));

type DeltaInput = {
    schemaVersion: number;
    command: string;
    correlation: { appRevision: number; projectRevision: string };
    nodes: unknown[];
    edges: unknown[];
    parameters: unknown[];
};

function createDelta(overrides: Partial<DeltaInput> = {}): DeltaInput {
    return {
        schemaVersion: 1,
        command: 'set-track-output',
        correlation: { appRevision: 4, projectRevision: 'project-revision-4' },
        nodes: [
            {
                id: 'source',
                kind: 'audio',
                devices: [{ id: 'compressor', type: 'builtin-compressor', parameterIds: ['attack', 'ratio'] }],
            },
            { id: 'return', kind: 'bus', devices: [] },
        ],
        edges: [{ kind: 'output', sourceId: 'source', targetId: 'return' }],
        parameters: [],
        ...overrides,
    };
}

function createDeviceChainDelta(overrides: Record<string, unknown> = {}) {
    return {
        schemaVersion: 1,
        command: 'replace-track-device-chain',
        correlation: { appRevision: 4, projectRevision: 'project-revision-4' },
        operation: 'add-device',
        before: {
            id: 'track-1',
            kind: 'audio',
            devices: [{ id: 'eq-1', type: 'eq', parameterIds: ['frequency'] }],
        },
        after: {
            id: 'track-1',
            kind: 'audio',
            devices: [
                { id: 'eq-1', type: 'eq', parameterIds: ['frequency'] },
                { id: 'compressor-1', type: 'compressor', parameterIds: ['attack', 'ratio'] },
            ],
        },
        parameters: [],
        ...overrides,
    };
}

function createTrackStripInitialization(overrides: Record<string, unknown> = {}) {
    return {
        schemaVersion: 1,
        command: 'initialize-track-strip',
        correlation: { appRevision: 4, projectRevision: 'project-revision-4' },
        nodes: [
            {
                id: 'source',
                kind: 'audio',
                devices: [{ id: 'compressor', type: 'builtin-compressor', parameterIds: ['attack', 'ratio'] }],
            },
        ],
        output: { kind: 'output', sourceId: 'source', targetId: 'hw_out' },
        parameters: [],
        ...overrides,
    };
}

describe('agent runtime graph boundary', () => {
    it('compiles a bounded immutable output delta with exact device order and parameter ids', () => {
        const result = compileRuntimeGraphDelta(createDelta());

        expect(result.status).toBe('compiled');
        if (result.status !== 'compiled' || result.delta.command !== 'set-track-output') {
            return;
        }
        expect(result.delta.nodes[0]?.devices.map((device) => device.id)).toEqual(['compressor']);
        expect(result.delta.nodes[0]?.devices.map((device) => device.type)).toEqual(['builtin-compressor']);
        expect(result.delta.nodes[0]?.devices[0]?.parameterIds).toEqual(['attack', 'ratio']);
        expect(Object.isFrozen(result.delta)).toBe(true);
        expect(Object.isFrozen(result.delta.nodes)).toBe(true);
        expect(Object.isFrozen(result.delta.nodes[0]?.devices)).toBe(true);
    });

    it('compiles an immutable device-chain add with exact before and after topology', () => {
        const result = compileRuntimeGraphDelta(createDeviceChainDelta());

        expect(result.status).toBe('compiled');
        if (result.status !== 'compiled' || result.delta.command !== 'replace-track-device-chain') {
            return;
        }
        expect(result.delta.before.devices.map((device) => device.id)).toEqual(['eq-1']);
        expect(result.delta.after.devices.map((device) => device.id)).toEqual(['eq-1', 'compressor-1']);
        expect(Object.isFrozen(result.delta.before.devices)).toBe(true);
        expect(Object.isFrozen(result.delta.after.devices[1]?.parameterIds)).toBe(true);
    });

    it('compiles one immutable preset replacement only when its complete ordered chain changes', () => {
        const result = compileRuntimeGraphDelta(
            createDeviceChainDelta({
                operation: 'replace-device-chain',
                after: {
                    id: 'track-1',
                    kind: 'audio',
                    devices: [{ id: 'preset-synth', type: 'builtin-synth', parameterIds: ['cutoff'] }],
                },
            })
        );

        expect(result).toMatchObject({ status: 'compiled' });
        expect(compileRuntimeGraphDelta(createDeviceChainDelta({ operation: 'replace-device-chain' })).status).toBe(
            'compiled'
        );
        expect(
            compileRuntimeGraphDelta(
                createDeviceChainDelta({
                    operation: 'replace-device-chain',
                    after: createDeviceChainDelta().before,
                })
            ).status
        ).toBe('invalid');
    });

    it('compiles one immutable baseline snapshot with exact output and device schema', () => {
        const result = compileRuntimeGraphDelta(createTrackStripInitialization());

        expect(result.status).toBe('compiled');
        if (result.status !== 'compiled' || result.delta.command !== 'initialize-track-strip') {
            return;
        }
        expect(result.delta.nodes[0]?.devices.map((device) => device.id)).toEqual(['compressor']);
        expect(result.delta.output).toEqual({ kind: 'output', sourceId: 'source', targetId: 'hw_out' });
        expect(Object.isFrozen(result.delta)).toBe(true);
        expect(Object.isFrozen(result.delta.output)).toBe(true);
    });

    it.each([
        [
            'duplicate graph nodes',
            createDelta({
                nodes: [
                    { id: 'source', kind: 'audio', devices: [] },
                    { id: 'source', kind: 'bus', devices: [] },
                ],
            }),
        ],
        ['missing output endpoint', createDelta({ nodes: [createDelta().nodes[0]] })],
        ['missing output edge', createDelta({ edges: [] })],
        ['unsupported topology kind', createDelta({ nodes: [{ id: 'source', kind: 'vca', devices: [] }] })],
        [
            'unordered endpoint',
            createDelta({
                nodes: [
                    { id: 'return', kind: 'bus', devices: [] },
                    { id: 'source', kind: 'audio', devices: [] },
                ],
            }),
        ],
        [
            'unsorted parameter ids',
            createDelta({
                nodes: [
                    {
                        id: 'source',
                        kind: 'audio',
                        devices: [{ id: 'compressor', type: 'builtin-compressor', parameterIds: ['ratio', 'attack'] }],
                    },
                    { id: 'return', kind: 'bus', devices: [] },
                ],
            }),
        ],
    ])('rejects %s before a runtime consumer can act', (_label, delta) => {
        expect(compileRuntimeGraphDelta(delta).status).toBe('invalid');
    });

    it.each([
        [
            'duplicate device identity',
            createDeviceChainDelta({
                after: {
                    ...createDeviceChainDelta().after,
                    devices: [
                        { id: 'eq-1', type: 'eq', parameterIds: ['frequency'] },
                        { id: 'eq-1', type: 'compressor', parameterIds: [] },
                    ],
                },
            }),
        ],
        [
            'unsorted parameter schema',
            createDeviceChainDelta({
                after: {
                    ...createDeviceChainDelta().after,
                    devices: [
                        { id: 'eq-1', type: 'eq', parameterIds: ['frequency'] },
                        { id: 'compressor-1', type: 'compressor', parameterIds: ['ratio', 'attack'] },
                    ],
                },
            }),
        ],
        [
            'operation does not match ordered chain',
            createDeviceChainDelta({ operation: 'add-device', after: createDeviceChainDelta().before }),
        ],
        ['extra continuous payload', createDeviceChainDelta({ parameters: [{ id: 'attack', value: 2 }] })],
    ])('rejects malformed device-chain proposals before live mutation: %s', (_label, delta) => {
        expect(compileRuntimeGraphDelta(delta).status).toBe('invalid');
    });

    it.each([
        [
            'duplicate device identities',
            createTrackStripInitialization({
                nodes: [
                    {
                        id: 'source',
                        kind: 'audio',
                        devices: [
                            { id: 'duplicate', type: 'eq', parameterIds: [] },
                            { id: 'duplicate', type: 'compressor', parameterIds: [] },
                        ],
                    },
                ],
            }),
        ],
        [
            'unsorted parameter schema',
            createTrackStripInitialization({
                nodes: [
                    {
                        id: 'source',
                        kind: 'audio',
                        devices: [{ id: 'compressor', type: 'compressor', parameterIds: ['ratio', 'attack'] }],
                    },
                ],
            }),
        ],
        ['extra continuous payload', createTrackStripInitialization({ parameters: [{ id: 'attack', value: 2 }] })],
        [
            'malformed output binding',
            createTrackStripInitialization({ output: { kind: 'output', sourceId: 'source', targetId: 'source' } }),
        ],
    ])('rejects malformed initialization snapshots before a live strip can publish: %s', (_label, snapshot) => {
        expect(compileRuntimeGraphDelta(snapshot).status).toBe('invalid');
    });
});

// Every context node-factory the live engine's constructor and device chains
// can call. Summing all of them, rather than one or two a test happens to
// think of, is what proves "no node created" instead of "no node this
// assertion bothered to check". `createWaveShaper` and `createIIRFilter` back
// tone-shaping devices (`createDistortion.ts`, `createBitcrusher.ts`) on the
// device-chain path these tests exercise; `createConstantSource` is summed for
// the same completeness even though no current device chain calls it.
const CONTEXT_NODE_FACTORY_NAMES = [
    'createGain',
    'createStereoPanner',
    'createChannelSplitter',
    'createChannelMerger',
    'createAnalyser',
    'createBiquadFilter',
    'createDynamicsCompressor',
    'createConvolver',
    'createOscillator',
    'createDelay',
    'createBufferSource',
    'createWaveShaper',
    'createIIRFilter',
    'createConstantSource',
] as const;

// Worklet devices build their node with `new AudioWorkletNode(ctx, …)`, which
// no context factory above records — folding a live count of it into the
// total is what makes "no node created" also cover the worklet route.
function totalNodeCreationCalls(mockCtx: MockAudioContext, workletNodeCallCount: number): number {
    return (
        CONTEXT_NODE_FACTORY_NAMES.reduce((total, name) => total + mockCtx[name].mock.calls.length, 0) +
        workletNodeCallCount
    );
}

/** The four master-tap nodes the engine wires in its constructor — the whole
 *  set a rejected call could reach without creating a new node at all. */
function totalMasterNodeConnectCalls(engine: AudioEngineTopologyTestHarness): number {
    return (
        (engine.masterGainNode.connect as unknown as Mock).mock.calls.length +
        (engine.masterAnalyser.connect as unknown as Mock).mock.calls.length +
        (engine.masterAnalyserLeft.connect as unknown as Mock).mock.calls.length +
        (engine.masterAnalyserRight.connect as unknown as Mock).mock.calls.length
    );
}

const INVALID_DELTA_INPUT = { schemaVersion: 1, command: 'not-a-real-command' };

describe('agent runtime graph boundary — live engine rejection', () => {
    // Both entry points share compileRuntimeGraphDelta's invalid branch
    // (createWebAudioEngine.ts:1203-1209 and :1354-1359), so the same
    // malformed input reaches the identical early return in each.
    function createHarness(): { engine: AudioEngineTopologyTestHarness; mockCtx: MockAudioContext } {
        const mockCtx = createMockAudioContext();
        const engine = createAudioEngineTopologyTestHarness(mockCtx as unknown as AudioContext);
        return { engine, mockCtx };
    }

    // A worklet device builds its node with `new AudioWorkletNode(ctx, …)`
    // rather than through a `mockCtx` factory, so counting it needs a spy on
    // the global constructor `src/setupTests.ts:261-269` installs — installed
    // fresh per case and restored after, so no count leaks between tests.
    let workletNodeCallCount: number;
    let originalAudioWorkletNode: typeof AudioWorkletNode;

    beforeEach(() => {
        workletNodeCallCount = 0;
        originalAudioWorkletNode = globalThis.AudioWorkletNode;
        globalThis.AudioWorkletNode = new Proxy(originalAudioWorkletNode, {
            construct(target, args) {
                workletNodeCallCount += 1;
                return Reflect.construct(target, args);
            },
        });
    });

    afterEach(() => {
        globalThis.AudioWorkletNode = originalAudioWorkletNode;
    });

    it('leaves the live graph unchanged when applyRuntimeGraphDelta rejects an invalid delta', () => {
        const { engine, mockCtx } = createHarness();
        const revisionBefore = engine.getRuntimeGraphRevision();
        const nodeCreationsBefore = totalNodeCreationCalls(mockCtx, workletNodeCallCount);
        const masterConnectsBefore = totalMasterNodeConnectCalls(engine);

        const result = engine.applyRuntimeGraphDelta(INVALID_DELTA_INPUT);

        expect(result).toEqual({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'Runtime graph delta schema version or command is unsupported',
        });
        // The returned result alone proves only what the function returned, not
        // that the graph was untouched — both halves are required.
        expect(engine.getRuntimeGraphRevision()).toBe(revisionBefore);
        expect(totalNodeCreationCalls(mockCtx, workletNodeCallCount)).toBe(nodeCreationsBefore);
        expect(totalMasterNodeConnectCalls(engine)).toBe(masterConnectsBefore);
    });

    it('leaves the live graph unchanged when initializeTrackStripFromSnapshot rejects an invalid snapshot', () => {
        const { engine, mockCtx } = createHarness();
        const revisionBefore = engine.getRuntimeGraphRevision();
        const nodeCreationsBefore = totalNodeCreationCalls(mockCtx, workletNodeCallCount);
        const masterConnectsBefore = totalMasterNodeConnectCalls(engine);

        const result = engine.initializeTrackStripFromSnapshot(INVALID_DELTA_INPUT);

        expect(result).toEqual({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'Runtime graph delta schema version or command is unsupported',
        });
        expect(engine.getRuntimeGraphRevision()).toBe(revisionBefore);
        expect(totalNodeCreationCalls(mockCtx, workletNodeCallCount)).toBe(nodeCreationsBefore);
        expect(totalMasterNodeConnectCalls(engine)).toBe(masterConnectsBefore);
    });
});

function createFakeRenderContext(overrides: Record<string, unknown> = {}) {
    return {
        tracks: null,
        midi: null,
        transport: null,
        defaultTempo: 120,
        changes: [],
        durationSeconds: 1,
        projectMidiEvents: vi.fn(),
        selectMidiEventProbability: vi.fn(() => true),
        projectChordPitch: ({ pitch }: { pitch: number }) => pitch,
        projectPpqEndpoints: vi.fn(() => ({ durationSeconds: 0 })),
        resolveTempoAtBeat: ({ defaultTempo }: { defaultTempo: number }) => defaultTempo,
        processYeastMidi: vi.fn(),
        ...overrides,
    };
}

describe('agent runtime graph boundary — preview isolation from offline render', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    // Every node the render creates *after* the master gain forwards its
    // `connect` argument here — the master gain's own unconditional wiring to
    // `offlineCtx.destination` (`renderOffline.ts:277`) is excluded so the
    // vacuity guard below cannot pass on that one connect alone; it can only
    // pass once the strip-building loop actually runs.
    let recordedOfflineConnectArgs: unknown[];

    // Local fake sized to what this case drives: a gain/panner factory so
    // `createOfflineTrackStrip` (renderOffline.spec.ts:154-161's pattern, run
    // for real here rather than mocked) can build a strip, and a
    // `startRendering` so the unsegmented fallback in `renderInSegments` (no
    // `suspend`/`resume` here) resolves. The very first `createGain()` call is
    // always the master gain (`renderOffline.ts:275`, before any strip is
    // built), so it alone is excluded from the recording.
    class RecordingOfflineAudioContext {
        readonly destination = {};
        readonly sampleRate = 48_000;
        private nodeCount = 0;

        private createRecordingNode(paramName: 'gain' | 'pan'): {
            gain: { value: number };
            pan: { value: number };
            connect: (dest: unknown) => unknown;
        } {
            this.nodeCount += 1;
            const isMasterGain = paramName === 'gain' && this.nodeCount === 1;
            return {
                gain: { value: 0 },
                pan: { value: 0 },
                connect: (dest: unknown) => {
                    if (!isMasterGain) {
                        recordedOfflineConnectArgs.push(dest);
                    }
                    return dest;
                },
            };
        }

        createGain(): { gain: { value: number }; connect: (dest: unknown) => unknown } {
            return this.createRecordingNode('gain');
        }

        createStereoPanner(): { pan: { value: number }; connect: (dest: unknown) => unknown } {
            return this.createRecordingNode('pan');
        }

        startRendering(): Promise<AudioBuffer> {
            return Promise.resolve({} as AudioBuffer);
        }
    }

    // Shape mirrors `renderOffline.spec.ts`'s `audioTrack` helper, extended
    // with the strip-level fields that helper never needed: that spec mocks
    // `createOfflineTrackStrip`, while this case runs the real builder (no
    // devices are built here, so `buildDeviceChain` runs for real too), whose
    // fader/pan law reads `gain`/`pan` directly.
    const offlineRenderTrack = {
        id: 'lead',
        name: 'Lead',
        kind: 'audio',
        disabled: false,
        muted: false,
        soloed: false,
        soloSafe: false,
        outputId: 'hw_out',
        gain: 1,
        pan: 0,
        vcaGroupId: null,
        devices: [],
        sends: [],
    };

    it('connects no node an offline render creates to a preview node playing on the live context', async () => {
        recordedOfflineConnectArgs = [];
        const livePreviewDestination = { role: 'live-preview-destination' };
        const livePreviewSource = {
            buffer: null as unknown,
            connect: vi.fn(),
            start: vi.fn(),
            stop: vi.fn(),
            onended: null as (() => void) | null,
        };
        previewSeamMocks.getAudioContext.mockReturnValue({
            createBuffer: () => ({ getChannelData: () => new Float32Array(4) }),
            destination: livePreviewDestination,
            sampleRate: 48_000,
        });
        previewSeamMocks.createBufferSource.mockReturnValue(livePreviewSource);
        // `tracks`/`midi` must both be truthy for `renderOffline.ts:140-141` to
        // build any strip at all — a null pair (the prior fixture default) makes
        // `allRenderableTracks` empty and the strip-building loop dead code.
        previewSeamMocks.resolveRenderContext.mockReturnValue(
            createFakeRenderContext({ tracks: { tracks: [offlineRenderTrack] }, midi: {} })
        );

        // Cache and start a preview on the live context (`cachePreviewAudioBuffer`/
        // `playCachedAudioBufferPreview`) before the offline render runs.
        const bufferId = cachePreviewAudioBuffer({ audio: new Float32Array([0.1, 0.2, 0.3, 0.4]), sampleRate: 48_000 });
        const playback = playCachedAudioBufferPreview({ bufferId, onEnded: () => {} });
        expect(playback).not.toBeNull();
        expect(livePreviewSource.connect).toHaveBeenCalledWith(livePreviewDestination);

        vi.stubGlobal('OfflineAudioContext', RecordingOfflineAudioContext);

        await renderOffline(4);

        // Vacuity guard: the strip-building loop this case exists to exercise
        // must itself have connected something — `createOfflineTrackStrip`'s
        // internal chain plus its `set-track-output` route to master — counted
        // only from nodes created *after* the master gain, so the master's own
        // unconditional wiring to `offlineCtx.destination` cannot satisfy this
        // on its own the way it did before the strip actually built.
        expect(recordedOfflineConnectArgs.length).toBeGreaterThan(0);
        expect(recordedOfflineConnectArgs).not.toContain(livePreviewSource);
        expect(recordedOfflineConnectArgs).not.toContain(livePreviewDestination);
    });
});
