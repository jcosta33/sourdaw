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

/** Every node any factory in `CONTEXT_NODE_FACTORY_NAMES` has produced on this
 *  mock context, read from each factory's `mock.results` rather than a fixed
 *  set of nodes a test happens to hold a reference to. The master gain and
 *  its three analysers are themselves products of `createGain`/`createAnalyser`,
 *  so this walk already includes them; nothing sums them a second time. It
 *  does not cover a worklet device's own node: a worklet node comes from
 *  `new AudioWorkletNode(...)`, never a context factory, so it never appears
 *  in a factory's `mock.results` — the `AudioWorkletNode` construction spy
 *  above covers that route instead. Shared by the connect and disconnect
 *  censuses below so both count edges over the identical node set. */
function mockContextNodesFromFactories(mockCtx: MockAudioContext): Array<{ connect: Mock; disconnect: Mock }> {
    return CONTEXT_NODE_FACTORY_NAMES.reduce<Array<{ connect: Mock; disconnect: Mock }>>((nodes, name) => {
        const factory = mockCtx[name] as unknown as Mock<(...args: unknown[]) => { connect: Mock; disconnect: Mock }>;
        const returnedNodes = factory.mock.results
            .filter(
                (result): result is { type: 'return'; value: { connect: Mock; disconnect: Mock } } =>
                    result.type === 'return'
            )
            .map((result) => result.value);
        return nodes.concat(returnedNodes);
    }, []);
}

/** Connect calls summed across every node the walk above finds. */
function totalConnectCallsAcrossMockContextNodes(mockCtx: MockAudioContext): number {
    return mockContextNodesFromFactories(mockCtx).reduce((total, node) => total + node.connect.mock.calls.length, 0);
}

/** Disconnect calls summed across the same node set the connect census
 *  walks — this is what proves a rejection removed no edge, not just added
 *  none. Unlike the connect census, this carries no greater-than-zero
 *  vacuity guard at construction: a freshly built engine graph legitimately
 *  disconnects nothing before any mutation runs, so a zero baseline is a
 *  true reading rather than a broken walk. The connect census's own guard
 *  already proves this walk sees the node set at all. */
function totalDisconnectCallsAcrossMockContextNodes(mockCtx: MockAudioContext): number {
    return mockContextNodesFromFactories(mockCtx).reduce((total, node) => total + node.disconnect.mock.calls.length, 0);
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
        const connectCallsBefore = totalConnectCallsAcrossMockContextNodes(mockCtx);
        const disconnectCallsBefore = totalDisconnectCallsAcrossMockContextNodes(mockCtx);
        // Vacuity guard: a census that saw nothing would pass the unchanged
        // assertion below no matter what the rejected input did.
        expect(connectCallsBefore).toBeGreaterThan(0);

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
        expect(totalConnectCallsAcrossMockContextNodes(mockCtx)).toBe(connectCallsBefore);
        expect(totalDisconnectCallsAcrossMockContextNodes(mockCtx)).toBe(disconnectCallsBefore);
    });

    it('leaves the live graph unchanged when initializeTrackStripFromSnapshot rejects an invalid snapshot', () => {
        const { engine, mockCtx } = createHarness();
        const revisionBefore = engine.getRuntimeGraphRevision();
        const nodeCreationsBefore = totalNodeCreationCalls(mockCtx, workletNodeCallCount);
        const connectCallsBefore = totalConnectCallsAcrossMockContextNodes(mockCtx);
        const disconnectCallsBefore = totalDisconnectCallsAcrossMockContextNodes(mockCtx);
        // Vacuity guard: a census that saw nothing would pass the unchanged
        // assertion below no matter what the rejected input did.
        expect(connectCallsBefore).toBeGreaterThan(0);

        const result = engine.initializeTrackStripFromSnapshot(INVALID_DELTA_INPUT);

        expect(result).toEqual({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'Runtime graph delta schema version or command is unsupported',
        });
        expect(engine.getRuntimeGraphRevision()).toBe(revisionBefore);
        expect(totalNodeCreationCalls(mockCtx, workletNodeCallCount)).toBe(nodeCreationsBefore);
        expect(totalConnectCallsAcrossMockContextNodes(mockCtx)).toBe(connectCallsBefore);
        expect(totalDisconnectCallsAcrossMockContextNodes(mockCtx)).toBe(disconnectCallsBefore);
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

    // Every `connect` the render makes forwards its argument here, the master
    // gain's included: the master gain is the render's output boundary
    // (`renderOffline.ts:277`), so a leak into a live preview node would reach
    // this recording through it, and the leak assertions must see it.
    let recordedOfflineConnectArgs: unknown[];

    // Connects made by nodes created *after* the master gain, counted apart
    // from the recording above so the master's own unconditional wiring to
    // `offlineCtx.destination` cannot satisfy the vacuity guard on its own; the
    // guard can only pass once the strip-building loop actually runs.
    let offlineConnectsAfterMasterGain: number;

    // Local fake sized to what this case drives: a gain/panner factory so
    // `createOfflineTrackStrip` (renderOffline.spec.ts:154-161's pattern, run
    // for real here rather than mocked) can build a strip, and a
    // `startRendering` so the unsegmented fallback in `renderInSegments` (no
    // `suspend`/`resume` here) resolves. The very first `createGain()` call is
    // always the master gain (`renderOffline.ts:275`, before any strip is
    // built), so it alone is left out of the post-master count.
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
                    recordedOfflineConnectArgs.push(dest);
                    if (!isMasterGain) {
                        offlineConnectsAfterMasterGain += 1;
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
        offlineConnectsAfterMasterGain = 0;
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
        expect(offlineConnectsAfterMasterGain).toBeGreaterThan(0);
        expect(recordedOfflineConnectArgs).not.toContain(livePreviewSource);
        expect(recordedOfflineConnectArgs).not.toContain(livePreviewDestination);
    });
});
