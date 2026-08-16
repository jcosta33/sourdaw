import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { createMockAudioContext, type MockAudioContext } from '../../../../helpers/__tests__/audioContext.mock';
import { createAudioEngine } from '../createWebAudioEngine';

import type { AudioEngine } from '../../models/AudioEngineState';
import type { RuntimeGraphDelta } from '../../models/RuntimeGraphDelta';

// Mock TrackNode and BusNode to avoid deep dependencies. The strip exposes the
// nodes that AudioEngineImpl reads directly (preFaderTap / analyserNode for
// sends and sidechain, deviceNodes for note-off fan-out, meterNode for the
// dispose shutdown sweep) so the engine's own routing logic is exercised.
function makeStripNode() {
    return {
        connect: vi.fn(),
        disconnect: vi.fn(),
        port: { postMessage: vi.fn(), close: vi.fn() },
    };
}

vi.mock('../../engine/TrackNode', () => ({
    TrackNode: class {
        trackId: string;
        strip: {
            trackId: string;
            gainNode: ReturnType<typeof makeStripNode>;
            preFaderTap: ReturnType<typeof makeStripNode>;
            analyserNode: ReturnType<typeof makeStripNode>;
            meterNode: ReturnType<typeof makeStripNode> | null;
            deviceNodes: unknown[];
            outputId?: string;
        };
        private deps: {
            masterGainNode: unknown;
            getTrackGainNode: (trackId: string) => unknown;
            onDeviceLoaded?: (trackId: string, device: unknown) => void;
            onDeviceRemoved?: (trackId: string, device: unknown) => void;
            reconnectRoutingForTrack?: (trackId: string) => void;
            onAsyncRuntimeGraphMutation?: (mutation: { application: 'applied' | 'needs-reconcile' }) => void;
        };
        private outputDestination: unknown;
        dispose = vi.fn();
        setGain = vi.fn();
        setPan = vi.fn();
        setMute = vi.fn();
        setOutput = vi.fn((outputId: string) => {
            const changed = this.strip.outputId !== outputId;
            this.strip.outputId = outputId;
            this.strip.analyserNode.disconnect(this.outputDestination);
            const destination = outputId === 'hw_out' ? this.deps.masterGainNode : this.deps.getTrackGainNode(outputId);
            this.strip.analyserNode.connect(destination ?? this.deps.masterGainNode);
            this.outputDestination = destination ?? this.deps.masterGainNode;
            return changed;
        });
        addDevice = vi.fn(
            (deviceId: string, type: string, _externalInstanceId?: string, precedingDeviceIds?: readonly string[]) => {
                if (
                    this.strip.deviceNodes.some(
                        (candidate) => (candidate as { deviceId?: string }).deviceId === deviceId
                    )
                ) {
                    return false;
                }
                const device = { deviceId, type };
                let targetIndex = this.strip.deviceNodes.length;
                if (precedingDeviceIds !== undefined) {
                    const precedingIds = new Set(precedingDeviceIds);
                    targetIndex = 0;
                    for (const [index, candidate] of this.strip.deviceNodes.entries()) {
                        if (precedingIds.has((candidate as { deviceId?: string }).deviceId ?? '')) {
                            targetIndex = index + 1;
                        }
                    }
                }
                this.strip.deviceNodes.splice(targetIndex, 0, device);
                this.rebuildChain();
                return true;
            }
        );
        getPeakLevel = vi.fn().mockReturnValue(0.5);
        removeDevice = vi.fn((deviceId: string) => {
            const device = this.strip.deviceNodes.find(
                (candidate) => (candidate as { deviceId?: string }).deviceId === deviceId
            );
            if (!device) {
                return false;
            }
            this.strip.deviceNodes = this.strip.deviceNodes.filter((candidate) => candidate !== device);
            this.deps.onDeviceRemoved?.(this.trackId, device);
            this.rebuildChain();
            return true;
        });
        updateBypass = vi.fn((deviceId: string, bypassed: boolean) => {
            const device = this.strip.deviceNodes.find(
                (candidate) => (candidate as { deviceId?: string }).deviceId === deviceId
            ) as { bypassed?: boolean } | undefined;
            if (!device) {
                return false;
            }
            const changed = device.bypassed !== bypassed;
            device.bypassed = bypassed;
            if (changed) {
                this.rebuildChain();
            }
            return changed;
        });
        rebuildChain = vi.fn(() => this.deps.reconnectRoutingForTrack?.(this.trackId));
        completeAsyncDevicePromotion = vi.fn((application: 'applied' | 'needs-reconcile' = 'applied') => {
            this.deps.onAsyncRuntimeGraphMutation?.({ application });
        });
        notifyDeviceLoaded(device: unknown) {
            this.strip.deviceNodes.push(device);
            this.deps.onDeviceLoaded?.(this.trackId, device);
        }
        constructor(
            id: string,
            deps: {
                masterGainNode: unknown;
                getTrackGainNode: (trackId: string) => unknown;
                onDeviceLoaded?: (trackId: string, device: unknown) => void;
                onDeviceRemoved?: (trackId: string, device: unknown) => void;
                reconnectRoutingForTrack?: (trackId: string) => void;
                onAsyncRuntimeGraphMutation?: (mutation: { application: 'applied' | 'needs-reconcile' }) => void;
            }
        ) {
            this.trackId = id;
            this.deps = deps;
            this.outputDestination = deps.masterGainNode;
            this.strip = {
                trackId: id,
                gainNode: makeStripNode(),
                preFaderTap: makeStripNode(),
                analyserNode: makeStripNode(),
                meterNode: makeStripNode(),
                deviceNodes: [],
            };
        }
    },
}));

vi.mock('../../engine/BusNode', () => ({
    BusNode: class {
        busId: string;
        strip: { busId: string; gainNode: { connect: Mock } };
        dispose = vi.fn();
        setGain = vi.fn();
        getPeakLevel = vi.fn().mockReturnValue(0.3);
        constructor(id: string, trackNode?: { strip?: { gainNode?: { connect: Mock } } }) {
            this.busId = id;
            this.strip = { busId: id, gainNode: trackNode?.strip?.gainNode ?? { connect: vi.fn() } };
        }
    },
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

/**
 * The engine constructor signature wants a real `AudioContext`; the mock matches
 * its surface structurally but not nominally. Funnel the conversion through one
 * typed helper so the test bodies work against the real `AudioEngine` interface
 * rather than `any` (the value under test stays fully typed at the call site).
 */
function asAudioContext(ctx: MockAudioContext): AudioContext {
    return ctx as unknown as AudioContext;
}

function makeFallbackEngine(): AudioEngine {
    class FailingAudioContext {
        constructor() {
            throw new Error('no AudioContext in this environment');
        }
    }
    const createGain = vi.fn(() => ({ gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() }));
    vi.stubGlobal('AudioContext', FailingAudioContext);
    vi.stubGlobal(
        'OfflineAudioContext',
        class {
            createGain = createGain;
            createAnalyser() {
                return { connect: vi.fn(), disconnect: vi.fn(), frequencyBinCount: 1 };
            }
        }
    );
    const fallbackEngine = createAudioEngine();
    // Expose the gain factory for assertions on the noop graph.
    (fallbackEngine as unknown as { __createGain: Mock }).__createGain = createGain;
    return fallbackEngine;
}

function getPendingSidechainRoutes(engine: AudioEngine): Map<string, unknown> {
    return (engine as unknown as { pendingSidechainRoutes: Map<string, unknown> }).pendingSidechainRoutes;
}

type MockTrackNode = {
    notifyDeviceLoaded(device: unknown): void;
    rebuildChain(): void;
    completeAsyncDevicePromotion(application?: 'applied' | 'needs-reconcile'): void;
    setOutput: Mock;
};

function getMockTrackNode(engine: AudioEngine, trackId: string): MockTrackNode {
    const node = (engine as unknown as { trackNodes: Map<string, MockTrackNode> }).trackNodes.get(trackId);
    if (!node) {
        throw new Error(`expected mock TrackNode for ${trackId}`);
    }
    return node;
}

function setPadTrackOutput(
    engine: AudioEngine,
    trackId: string,
    outputId: string,
    toasterParentTrackId: string,
    padIndex: number
): void {
    engine.setTrackOutput(trackId, outputId, { toasterParentTrackId, padIndex });
}

function createRuntimeOutputDelta(appRevision: number): RuntimeGraphDelta {
    return {
        schemaVersion: 1,
        command: 'set-track-output',
        correlation: { appRevision, projectRevision: 'project-revision-1' },
        nodes: [
            { id: 'source', kind: 'audio', devices: [] },
            { id: 'target', kind: 'bus', devices: [] },
        ],
        edges: [{ kind: 'output', sourceId: 'source', targetId: 'target' }],
        parameters: [] as const,
    };
}

function createMasterRuntimeOutputDelta(appRevision: number): RuntimeGraphDelta {
    return {
        schemaVersion: 1,
        command: 'set-track-output',
        correlation: { appRevision, projectRevision: 'project-revision-1' },
        nodes: [{ id: 'source', kind: 'audio', devices: [] }],
        edges: [{ kind: 'output', sourceId: 'source', targetId: 'master' }],
        parameters: [] as const,
    };
}

function createDeviceRuntimeOutputDelta(appRevision: number): RuntimeGraphDelta {
    return {
        schemaVersion: 1,
        command: 'set-track-output',
        correlation: { appRevision, projectRevision: 'project-revision-1' },
        nodes: [
            {
                id: 'source',
                kind: 'audio',
                devices: [{ id: 'compressor', type: 'builtin-compressor', parameterIds: ['attack', 'ratio'] }],
            },
            { id: 'target', kind: 'bus', devices: [] },
        ],
        edges: [{ kind: 'output', sourceId: 'source', targetId: 'target' }],
        parameters: [] as const,
    };
}

function createRuntimeOutputDeltaWithDevices(
    appRevision: number,
    sourceDevices: ReadonlyArray<{ id: string; type: string }>,
    targetDevices: ReadonlyArray<{ id: string; type: string }> = []
): RuntimeGraphDelta {
    return {
        schemaVersion: 1,
        command: 'set-track-output',
        correlation: { appRevision, projectRevision: 'project-revision-1' },
        nodes: [
            {
                id: 'source',
                kind: 'audio',
                devices: sourceDevices.map((device) => ({ ...device, parameterIds: [] })),
            },
            {
                id: 'target',
                kind: 'bus',
                devices: targetDevices.map((device) => ({ ...device, parameterIds: [] })),
            },
        ],
        edges: [{ kind: 'output', sourceId: 'source', targetId: 'target' }],
        parameters: [] as const,
    };
}

describe('AudioEngine', () => {
    let engine: AudioEngine;
    let mockCtx: MockAudioContext;
    let currentProjectRevision: string;

    class FakeWorkletNode {
        port = { postMessage: vi.fn() };
        connect = vi.fn();
        disconnect = vi.fn();
    }

    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.clear();
        mockCtx = createMockAudioContext();

        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
        vi.stubGlobal(
            'SharedArrayBuffer',
            class extends ArrayBuffer {
                constructor(length: number) {
                    super(length);
                }
            }
        );

        currentProjectRevision = 'project-revision-1';
        engine = createAudioEngine(asAudioContext(mockCtx));
        engine.setRuntimeGraphProjectRevisionValidator(
            (expectedProjectRevision) => expectedProjectRevision === currentProjectRevision
        );
        engine.setRuntimeGraphTopologyValidator(() => true);
    });

    it('should initialize with master nodes', () => {
        expect(engine.context).toBeDefined();
        expect(engine.masterGainNode).toBeDefined();
        expect(engine.masterAnalyser).toBeDefined();
        expect(mockCtx.createGain).toHaveBeenCalled();
        expect(mockCtx.createAnalyser).toHaveBeenCalled();
    });

    it('should load worklets on initialize', async () => {
        await engine.initialize();
        // sidechain-compressor, native-plugin-host, native-plugin-bridge,
        // recording, metering, bitcrusher-rate.
        expect(mockCtx.audioWorklet.addModule).toHaveBeenCalledTimes(6);
    });

    it('should manage master gain', () => {
        engine.setMasterGain(0.5);
        expect(engine.masterGainNode.gain.setTargetAtTime).toHaveBeenCalledWith(0.5, expect.any(Number), 0.01);

        engine.masterGainNode.gain.value = 0.5;
        expect(engine.getMasterGain()).toBe(0.5);
    });

    it('should ensure and remove track strips', () => {
        const strip = engine.ensureTrackStrip('t1');
        expect(strip.trackId).toBe('t1');

        const retrieved = engine.getTrackStrip('t1');
        expect(retrieved).toBe(strip);

        void engine.removeTrackStrip('t1');
        expect(engine.getTrackStrip('t1')).toBeUndefined();
    });

    it('reports the master peak as unavailable until initialize() wires the meter tap', () => {
        // The master gain/analyser exist from the constructor, but the SAB-backed
        // metering-processor is only inserted by initialize(). Until then there is
        // no measurement, and `null` says so; a `0` here would render as "-∞ dB"
        // and read as a silent mix.
        expect(engine.getMasterPeakLevel()).toBeNull();
    });

    it('routes sends into device-bearing and ordinary bus track inputs', () => {
        const source = engine.ensureTrackStrip('source');
        const deviceBus = engine.ensureTrackStrip('device-bus');
        const ordinaryBus = engine.ensureTrackStrip('ordinary-bus');
        deviceBus.deviceNodes.push({ deviceId: 'return-fx' } as never);

        engine.setSend('source', 'device-bus', 0.6, false);
        const deviceSendGain = mockCtx.createGain.mock.results.at(-1)!.value as { connect: Mock };
        engine.setSend('source', 'ordinary-bus', 0.4, false);
        const ordinarySendGain = mockCtx.createGain.mock.results.at(-1)!.value as { connect: Mock };

        expect(source.analyserNode.connect).toHaveBeenCalledWith(deviceSendGain);
        expect(deviceSendGain.connect).toHaveBeenCalledWith(deviceBus.gainNode);
        expect(ordinarySendGain.connect).toHaveBeenCalledWith(ordinaryBus.gainNode);
    });

    it('does not route an unvalidated output edge to the master bus', () => {
        const source = engine.ensureTrackStrip('source');

        engine.setTrackOutput('source', 'missing-runtime-destination');

        expect(source.outputId).not.toBe('missing-runtime-destination');
        expect(source.analyserNode.connect).not.toHaveBeenCalledWith(engine.masterGainNode);
    });

    it('applies a revision-correlated immutable output delta once and rejects its stale replay', () => {
        const source = engine.ensureTrackStrip('source');
        engine.ensureTrackStrip('target');
        const delta = createRuntimeOutputDelta(engine.getRuntimeGraphRevision());

        const applied = engine.applyRuntimeGraphDelta(delta);
        const staleReplay = engine.applyRuntimeGraphDelta(delta);

        expect(applied).toMatchObject({
            acceptance: 'accepted',
            application: 'applied',
            correlation: { appRevision: 2, projectRevision: 'project-revision-1' },
            runtimeRevision: 3,
        });
        expect(source.outputId).toBe('target');
        expect(staleReplay).toMatchObject({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: expect.stringContaining('stale'),
        });
    });

    it('rejects a delta compiled before target deletion reroutes its source and the target is recreated', () => {
        const source = engine.ensureTrackStrip('source');
        engine.ensureTrackStrip('target');
        engine.setTrackOutput('source', 'target');
        const staleDelta = createRuntimeOutputDelta(engine.getRuntimeGraphRevision());

        engine.removeTrackStrip('target');
        expect(source.outputId).toBe('hw_out');
        engine.ensureTrackStrip('target');
        vi.mocked(getMockTrackNode(engine, 'source').setOutput).mockClear();

        const result = engine.applyRuntimeGraphDelta(staleDelta);

        expect(result).toMatchObject({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: expect.stringContaining('stale'),
        });
        expect(getMockTrackNode(engine, 'source').setOutput).not.toHaveBeenCalled();
        expect(engine.getRuntimeGraphRevision()).toBeGreaterThan(staleDelta.correlation.appRevision);
    });

    it('rejects a delta compiled before an asynchronous device promotion reaches the live graph', () => {
        engine.ensureTrackStrip('source');
        engine.ensureTrackStrip('target');
        const staleDelta = createRuntimeOutputDelta(engine.getRuntimeGraphRevision());
        const revisionBeforePromotion = engine.getRuntimeGraphRevision();

        getMockTrackNode(engine, 'source').completeAsyncDevicePromotion();
        expect(engine.getRuntimeGraphRevision()).toBe(revisionBeforePromotion + 1);
        vi.mocked(getMockTrackNode(engine, 'source').setOutput).mockClear();

        const result = engine.applyRuntimeGraphDelta(staleDelta);

        expect(result).toMatchObject({ acceptance: 'rejected', application: 'not-applied' });
        expect(getMockTrackNode(engine, 'source').setOutput).not.toHaveBeenCalled();
    });

    it('rejects a delta after an asynchronous device path reports that reconciliation is required', () => {
        engine.ensureTrackStrip('source');
        engine.ensureTrackStrip('target');
        const staleDelta = createRuntimeOutputDelta(engine.getRuntimeGraphRevision());
        const revisionBeforeReconcile = engine.getRuntimeGraphRevision();

        getMockTrackNode(engine, 'source').completeAsyncDevicePromotion('needs-reconcile');
        expect(engine.getRuntimeGraphRevision()).toBe(revisionBeforeReconcile + 1);
        vi.mocked(getMockTrackNode(engine, 'source').setOutput).mockClear();

        const result = engine.applyRuntimeGraphDelta(staleDelta);

        expect(result).toMatchObject({ acceptance: 'rejected', application: 'not-applied' });
        expect(getMockTrackNode(engine, 'source').setOutput).not.toHaveBeenCalled();
    });

    it('rejects a delta after a device is added then removed back to the same topology', () => {
        engine.ensureTrackStrip('source');
        engine.ensureTrackStrip('target');
        const staleDelta = createRuntimeOutputDelta(engine.getRuntimeGraphRevision());

        engine.addDeviceToStrip('source', 'transient-device', 'builtin-compressor');
        engine.removeDeviceFromStrip('source', 'transient-device');
        vi.mocked(getMockTrackNode(engine, 'source').setOutput).mockClear();

        const result = engine.applyRuntimeGraphDelta(staleDelta);

        expect(result).toMatchObject({ acceptance: 'rejected', application: 'not-applied' });
        expect(getMockTrackNode(engine, 'source').setOutput).not.toHaveBeenCalled();
    });

    it('rejects a delta after a device reorder cycle restores the original canonical order', () => {
        engine.ensureTrackStrip('source');
        engine.ensureTrackStrip('target');
        engine.addDeviceToStrip('source', 'device-a', 'builtin-compressor');
        engine.addDeviceToStrip('source', 'device-b', 'builtin-limiter');
        const staleDelta = createRuntimeOutputDeltaWithDevices(engine.getRuntimeGraphRevision(), [
            { id: 'device-a', type: 'builtin-compressor' },
            { id: 'device-b', type: 'builtin-limiter' },
        ]);

        engine.removeDeviceFromStrip('source', 'device-b');
        engine.addDeviceToStrip('source', 'device-b', 'builtin-limiter', undefined, []);
        engine.removeDeviceFromStrip('source', 'device-b');
        engine.addDeviceToStrip('source', 'device-b', 'builtin-limiter', undefined, ['device-a']);
        vi.mocked(getMockTrackNode(engine, 'source').setOutput).mockClear();

        const result = engine.applyRuntimeGraphDelta(staleDelta);

        expect(result).toMatchObject({ acceptance: 'rejected', application: 'not-applied' });
        expect(getMockTrackNode(engine, 'source').setOutput).not.toHaveBeenCalled();
    });

    it('rejects a delta after a bypass cycle changes the active device path and restores it', () => {
        engine.ensureTrackStrip('source');
        engine.ensureTrackStrip('target');
        engine.addDeviceToStrip('source', 'compressor', 'builtin-compressor');
        const staleDelta = createRuntimeOutputDeltaWithDevices(engine.getRuntimeGraphRevision(), [
            { id: 'compressor', type: 'builtin-compressor' },
        ]);

        engine.updateDeviceBypass('source', 'compressor', true);
        engine.updateDeviceBypass('source', 'compressor', false);
        vi.mocked(getMockTrackNode(engine, 'source').setOutput).mockClear();

        const result = engine.applyRuntimeGraphDelta(staleDelta);

        expect(result).toMatchObject({ acceptance: 'rejected', application: 'not-applied' });
        expect(getMockTrackNode(engine, 'source').setOutput).not.toHaveBeenCalled();
    });

    it('rejects deltas across sidechain route creation and removal without treating alignment writes as topology', () => {
        engine.ensureTrackStrip('source');
        const target = engine.ensureTrackStrip('target');
        target.deviceNodes.push({
            deviceId: 'sidechain-compressor',
            type: 'builtin-sidechain-compressor',
            inputNode: makeStripNode() as unknown as AudioNode,
        } as never);
        const deltaBeforeWire = createRuntimeOutputDeltaWithDevices(
            engine.getRuntimeGraphRevision(),
            [],
            [{ id: 'sidechain-compressor', type: 'builtin-sidechain-compressor' }]
        );

        engine.wireSidechainRoute('source', 'target', 'sidechain-compressor');
        const revisionAfterWire = engine.getRuntimeGraphRevision();
        engine.refreshSidechainAlignment(() => 0.01);
        expect(engine.getRuntimeGraphRevision()).toBe(revisionAfterWire);
        vi.mocked(getMockTrackNode(engine, 'source').setOutput).mockClear();
        const afterWire = engine.applyRuntimeGraphDelta(deltaBeforeWire);

        expect(afterWire).toMatchObject({ acceptance: 'rejected', application: 'not-applied' });
        expect(getMockTrackNode(engine, 'source').setOutput).not.toHaveBeenCalled();

        const deltaBeforeUnwire = createRuntimeOutputDeltaWithDevices(
            engine.getRuntimeGraphRevision(),
            [],
            [{ id: 'sidechain-compressor', type: 'builtin-sidechain-compressor' }]
        );
        engine.unwireSidechainRoute('source', 'sidechain-compressor');
        vi.mocked(getMockTrackNode(engine, 'source').setOutput).mockClear();
        const afterUnwire = engine.applyRuntimeGraphDelta(deltaBeforeUnwire);

        expect(afterUnwire).toMatchObject({ acceptance: 'rejected', application: 'not-applied' });
        expect(getMockTrackNode(engine, 'source').setOutput).not.toHaveBeenCalled();
    });

    it('advances once for a new send topology, skips level writes, and advances for a tap change', () => {
        engine.ensureTrackStrip('source');
        const initialRevision = engine.getRuntimeGraphRevision();

        engine.setSend('source', 'bus', 0.25, false);
        expect(engine.getRuntimeGraphRevision()).toBe(initialRevision + 1);

        engine.setSend('source', 'bus', 0.75, false);
        expect(engine.getRuntimeGraphRevision()).toBe(initialRevision + 1);

        engine.setSend('source', 'bus', 0.75, true);
        expect(engine.getRuntimeGraphRevision()).toBe(initialRevision + 2);
    });

    it('does not publish a second revision when a bus facade follows its already-removed track strip', () => {
        engine.ensureBusStrip('bus');
        const beforeRemoval = engine.getRuntimeGraphRevision();

        engine.removeTrackStrip('bus');
        engine.removeBusStrip('bus');

        expect(engine.getRuntimeGraphRevision()).toBe(beforeRemoval + 1);
    });

    it('does not advance for idempotent, rejected, or absent graph commands', () => {
        engine.ensureTrackStrip('source');
        const revision = engine.getRuntimeGraphRevision();

        engine.ensureTrackStrip('source');
        engine.setTrackOutput('source', 'missing-runtime-destination');
        engine.removeDeviceFromStrip('source', 'absent-device');
        engine.removeSend('source', 'absent-bus');
        engine.unwireSidechainRoute('source', 'absent-device');
        engine.removeTrackStrip('absent-track');

        expect(engine.getRuntimeGraphRevision()).toBe(revision);

        engine.setTrackOutput('source', 'master');
        const revisionAfterRoute = engine.getRuntimeGraphRevision();
        engine.setTrackOutput('source', 'master');

        expect(engine.getRuntimeGraphRevision()).toBe(revisionAfterRoute);
    });

    it('applies current project deltas to master and track outputs', () => {
        const source = engine.ensureTrackStrip('source');
        engine.ensureTrackStrip('target');

        const masterResult = engine.applyRuntimeGraphDelta(
            createMasterRuntimeOutputDelta(engine.getRuntimeGraphRevision())
        );
        const trackResult = engine.applyRuntimeGraphDelta(createRuntimeOutputDelta(engine.getRuntimeGraphRevision()));

        expect(masterResult).toMatchObject({ acceptance: 'accepted', application: 'applied', runtimeRevision: 3 });
        expect(trackResult).toMatchObject({ acceptance: 'accepted', application: 'applied', runtimeRevision: 4 });
        expect(getMockTrackNode(engine, 'source').setOutput).toHaveBeenNthCalledWith(1, 'master');
        expect(source.outputId).toBe('target');
    });

    it('rejects a stale project delta before the live output mutation', () => {
        const source = engine.ensureTrackStrip('source');
        engine.ensureTrackStrip('target');
        currentProjectRevision = 'project-revision-A';
        const delta: RuntimeGraphDelta = {
            ...createRuntimeOutputDelta(engine.getRuntimeGraphRevision()),
            correlation: { appRevision: engine.getRuntimeGraphRevision(), projectRevision: currentProjectRevision },
        };
        currentProjectRevision = 'project-revision-B';

        const result = engine.applyRuntimeGraphDelta(delta);

        expect(result).toMatchObject({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: expect.stringContaining('project revision'),
        });
        expect(getMockTrackNode(engine, 'source').setOutput).not.toHaveBeenCalled();
        expect(source.outputId).toBeUndefined();
        expect(engine.getRuntimeGraphRevision()).toBe(2);
    });

    it('rejects a same-id device with a different supported factory type before the live output mutation', () => {
        const source = engine.ensureTrackStrip('source');
        engine.ensureTrackStrip('target');
        source.deviceNodes.push({ deviceId: 'compressor', type: 'builtin-compressor' } as never);
        const delta = createDeviceRuntimeOutputDelta(engine.getRuntimeGraphRevision());
        const wrongType: RuntimeGraphDelta = {
            ...delta,
            nodes: [
                {
                    ...delta.nodes[0]!,
                    devices: [{ id: 'compressor', type: 'builtin-limiter', parameterIds: ['attack', 'ratio'] }],
                },
                delta.nodes[1]!,
            ],
        };

        const result = engine.applyRuntimeGraphDelta(wrongType);

        expect(result).toMatchObject({ acceptance: 'rejected', application: 'not-applied' });
        expect(getMockTrackNode(engine, 'source').setOutput).not.toHaveBeenCalled();
        expect(engine.getRuntimeGraphRevision()).toBe(2);
    });

    it.each([
        [
            'different supported node kind',
            (delta: RuntimeGraphDelta) => ({ ...delta.nodes[0]!, kind: 'midi' as const }),
        ],
        [
            'stale parameter ids',
            (delta: RuntimeGraphDelta) => ({
                ...delta.nodes[0]!,
                devices: [{ id: 'compressor', type: 'builtin-compressor', parameterIds: ['attack', 'release'] }],
            }),
        ],
        [
            'missing parameter ids',
            (delta: RuntimeGraphDelta) => ({
                ...delta.nodes[0]!,
                devices: [{ id: 'compressor', type: 'builtin-compressor', parameterIds: ['attack'] }],
            }),
        ],
        [
            'extra parameter ids',
            (delta: RuntimeGraphDelta) => ({
                ...delta.nodes[0]!,
                devices: [
                    { id: 'compressor', type: 'builtin-compressor', parameterIds: ['attack', 'ratio', 'threshold'] },
                ],
            }),
        ],
    ])('rejects %s before the live output mutation', (_label, mutateSource) => {
        const source = engine.ensureTrackStrip('source');
        engine.ensureTrackStrip('target');
        source.deviceNodes.push({ deviceId: 'compressor', type: 'builtin-compressor' } as never);
        const delta = createDeviceRuntimeOutputDelta(engine.getRuntimeGraphRevision());
        engine.setRuntimeGraphTopologyValidator((nodes) => JSON.stringify(nodes) === JSON.stringify(delta.nodes));
        const mismatch: RuntimeGraphDelta = {
            ...delta,
            nodes: [mutateSource(delta), delta.nodes[1]!],
        };

        const result = engine.applyRuntimeGraphDelta(mismatch);

        expect(result).toMatchObject({ acceptance: 'rejected', application: 'not-applied' });
        expect(getMockTrackNode(engine, 'source').setOutput).not.toHaveBeenCalled();
        expect(engine.getRuntimeGraphRevision()).toBe(2);
    });

    it('rejects duplicate parameter ids before the live output mutation', () => {
        const source = engine.ensureTrackStrip('source');
        engine.ensureTrackStrip('target');
        const delta = createDeviceRuntimeOutputDelta(engine.getRuntimeGraphRevision());
        const duplicateParameterIds: RuntimeGraphDelta = {
            ...delta,
            nodes: [
                {
                    ...delta.nodes[0]!,
                    devices: [{ id: 'compressor', type: 'builtin-compressor', parameterIds: ['attack', 'attack'] }],
                },
                delta.nodes[1]!,
            ],
        };

        const result = engine.applyRuntimeGraphDelta(duplicateParameterIds);

        expect(result).toMatchObject({ acceptance: 'rejected', application: 'not-applied' });
        expect(getMockTrackNode(engine, 'source').setOutput).not.toHaveBeenCalled();
        expect(source.outputId).toBeUndefined();
        expect(engine.getRuntimeGraphRevision()).toBe(2);
    });

    it('applies unchanged exact topology to a terminal output', () => {
        const source = engine.ensureTrackStrip('source');
        source.deviceNodes.push({ deviceId: 'compressor', type: 'builtin-compressor' } as never);
        const delta: RuntimeGraphDelta = {
            schemaVersion: 1,
            command: 'set-track-output',
            correlation: { appRevision: engine.getRuntimeGraphRevision(), projectRevision: 'project-revision-1' },
            nodes: [
                {
                    id: 'source',
                    kind: 'audio',
                    devices: [{ id: 'compressor', type: 'builtin-compressor', parameterIds: ['attack', 'ratio'] }],
                },
            ],
            edges: [{ kind: 'output', sourceId: 'source', targetId: 'master' }],
            parameters: [],
        };
        engine.setRuntimeGraphTopologyValidator((nodes) => JSON.stringify(nodes) === JSON.stringify(delta.nodes));

        const result = engine.applyRuntimeGraphDelta(delta);

        expect(result).toMatchObject({ acceptance: 'accepted', application: 'applied', runtimeRevision: 2 });
        expect(source.outputId).toBe('master');
    });

    it('requires reconciliation without claiming compensation when an accepted output delta partially fails', () => {
        engine.ensureTrackStrip('source');
        engine.ensureTrackStrip('target');
        const sourceNode = getMockTrackNode(engine, 'source');
        sourceNode.setOutput.mockImplementationOnce(() => {
            throw new Error('destination disconnected during host apply');
        });

        const result = engine.applyRuntimeGraphDelta(createRuntimeOutputDelta(engine.getRuntimeGraphRevision()));

        expect(result).toMatchObject({
            acceptance: 'accepted',
            application: 'needs-reconcile',
            compensation: 'not-attempted',
            runtimeRevision: 3,
        });
    });

    it('does not touch the live graph when compiled device order no longer matches it', () => {
        const source = engine.ensureTrackStrip('source');
        engine.ensureTrackStrip('target');
        source.deviceNodes.push({ deviceId: 'runtime-device' } as never);

        const result = engine.applyRuntimeGraphDelta(createRuntimeOutputDelta(engine.getRuntimeGraphRevision()));

        expect(result).toMatchObject({ acceptance: 'rejected', application: 'not-applied' });
        expect(source.outputId).toBeUndefined();
    });

    it('routes a Toaster pad through the child chain across reroute, rebuild, replacement, and reset', () => {
        const child = engine.ensureTrackStrip('pad-track');
        engine.ensureTrackStrip('toaster-parent');
        engine.setSend('pad-track', 'pre-bus', 0.5, true);
        const preSendGain = mockCtx.createGain.mock.results.at(-1)!.value;
        engine.setSend('pad-track', 'post-bus', 0.5, false);
        const postSendGain = mockCtx.createGain.mock.results.at(-1)!.value;
        const target = engine.ensureTrackStrip('sidechain-target');
        target.deviceNodes.push({
            deviceId: 'sidechain-device',
            type: 'builtin-sidechain-compressor',
            inputNode: makeStripNode() as unknown as AudioNode,
        } as never);
        engine.wireSidechainRoute('pad-track', 'sidechain-target', 'sidechain-device');
        const sidechainGain = mockCtx.createGain.mock.results.at(-1)!.value;
        // FX-5 — the post-fader tap now lands on the key alignment line, which
        // feeds the route gain; rebuilds must re-attach that same edge.
        const sidechainKeyDelay = mockCtx.createDelay.mock.results.at(-1)!.value;

        setPadTrackOutput(engine, 'pad-track', 'post-bus', 'toaster-parent', 3);
        const firstControls = {
            connectPadOutput: vi.fn(),
            disconnectPadOutput: vi.fn(),
            setPadDryRouted: vi.fn(),
        };
        const firstDevice = { deviceId: 'toaster-1', type: 'toaster', nodes: [], toasterControls: firstControls };
        const parentNode = getMockTrackNode(engine, 'toaster-parent');
        parentNode.notifyDeviceLoaded(firstDevice);

        expect(child.outputId).toBe('post-bus');
        expect(firstControls.connectPadOutput).toHaveBeenCalledWith(3, child.gainNode);
        expect(firstControls.setPadDryRouted).toHaveBeenCalledWith(3, true);
        expect(firstControls.connectPadOutput.mock.invocationCallOrder[0]).toBeLessThan(
            firstControls.setPadDryRouted.mock.invocationCallOrder[0]!
        );
        expect(child.preFaderTap.connect).toHaveBeenCalledWith(preSendGain);
        expect(child.analyserNode.connect).toHaveBeenCalledWith(postSendGain);
        expect(child.analyserNode.connect).toHaveBeenCalledWith(sidechainKeyDelay);
        expect(sidechainKeyDelay.connect).toHaveBeenCalledWith(sidechainGain);

        setPadTrackOutput(engine, 'pad-track', 'hw_out', 'toaster-parent', 3);
        setPadTrackOutput(engine, 'pad-track', 'post-bus', 'toaster-parent', 3);
        expect(firstControls.connectPadOutput).toHaveBeenCalledTimes(1);
        expect(child.outputId).toBe('post-bus');

        vi.mocked(child.preFaderTap.connect).mockClear();
        vi.mocked(child.analyserNode.connect).mockClear();
        getMockTrackNode(engine, 'pad-track').rebuildChain();
        expect(child.preFaderTap.connect).toHaveBeenCalledWith(preSendGain);
        expect(child.analyserNode.connect).toHaveBeenCalledWith(postSendGain);
        expect(child.analyserNode.connect).toHaveBeenCalledWith(sidechainKeyDelay);

        const replacementControls = {
            connectPadOutput: vi.fn(),
            disconnectPadOutput: vi.fn(),
            setPadDryRouted: vi.fn(),
        };
        parentNode.notifyDeviceLoaded({
            deviceId: 'toaster-2',
            type: 'toaster',
            nodes: [],
            toasterControls: replacementControls,
        });
        engine.removeDeviceFromStrip('toaster-parent', firstDevice.deviceId);

        expect(firstControls.disconnectPadOutput).toHaveBeenCalledWith(3, child.gainNode);
        expect(firstControls.setPadDryRouted).toHaveBeenLastCalledWith(3, false);
        expect(replacementControls.connectPadOutput).toHaveBeenCalledWith(3, child.gainNode);
        expect(replacementControls.setPadDryRouted).toHaveBeenCalledWith(3, true);

        engine.resetGraph();
        expect(replacementControls.disconnectPadOutput).toHaveBeenCalledWith(3, child.gainNode);
        expect(replacementControls.setPadDryRouted).toHaveBeenLastCalledWith(3, false);
        const lateControls = { connectPadOutput: vi.fn(), disconnectPadOutput: vi.fn(), setPadDryRouted: vi.fn() };
        parentNode.notifyDeviceLoaded({ deviceId: 'late', type: 'toaster', nodes: [], toasterControls: lateControls });
        expect(lateControls.connectPadOutput).not.toHaveBeenCalled();
    });

    it('leaves both final pads dry-routed after an atomic sibling swap', () => {
        engine.ensureTrackStrip('stem-a');
        engine.ensureTrackStrip('stem-b');
        engine.ensureTrackStrip('toaster-parent');
        const parentNode = getMockTrackNode(engine, 'toaster-parent');
        const controls = { connectPadOutput: vi.fn(), disconnectPadOutput: vi.fn(), setPadDryRouted: vi.fn() };
        parentNode.notifyDeviceLoaded({ deviceId: 'toaster', type: 'toaster', nodes: [], toasterControls: controls });
        setPadTrackOutput(engine, 'stem-a', 'toaster-parent', 'toaster-parent', 0);
        setPadTrackOutput(engine, 'stem-b', 'toaster-parent', 'toaster-parent', 1);

        engine.setTrackOutput('stem-a', 'toaster-parent');
        engine.setTrackOutput('stem-b', 'toaster-parent');
        setPadTrackOutput(engine, 'stem-b', 'toaster-parent', 'toaster-parent', 0);
        setPadTrackOutput(engine, 'stem-a', 'toaster-parent', 'toaster-parent', 1);

        expect(controls.setPadDryRouted.mock.calls.slice(-2)).toEqual([
            [0, true],
            [1, true],
        ]);
    });

    it('removes the paired track strip when a bus facade is removed', () => {
        engine.ensureBusStrip('return-bus');

        engine.removeBusStrip('return-bus');

        expect(engine.getTrackStrip('return-bus')).toBeUndefined();
    });

    // ── Fix 1: removeTrackStrip sweeps dependent send/sidechain entries ──────────
    describe('removeTrackStrip dependent-route sweep', () => {
        it('reroutes every inbound track output to the master destination', () => {
            const inboundA = engine.ensureTrackStrip('inbound-a');
            const inboundB = engine.ensureTrackStrip('inbound-b');
            const target = engine.ensureTrackStrip('target');
            engine.setTrackOutput('inbound-a', 'target');
            engine.setTrackOutput('inbound-b', 'target');

            engine.setSend('inbound-a', 'unrelated-bus', 0.5);
            const unrelatedSendGain = mockCtx.createGain.mock.results.at(-1)!.value as { disconnect: Mock };
            const sidechainTarget = engine.ensureTrackStrip('unrelated-sidechain-target');
            sidechainTarget.deviceNodes.push({
                deviceId: 'unrelated-sidechain-device',
                type: 'builtin-sidechain-compressor',
                inputNode: makeStripNode() as unknown as AudioNode,
            } as never);
            engine.wireSidechainRoute('inbound-a', 'unrelated-sidechain-target', 'unrelated-sidechain-device');
            const unrelatedSidechainGain = mockCtx.createGain.mock.results.at(-1)!.value as { disconnect: Mock };
            vi.mocked(inboundA.analyserNode.disconnect).mockClear();

            engine.removeTrackStrip('target');

            expect(inboundA.outputId).toBe('hw_out');
            expect(inboundB.outputId).toBe('hw_out');
            expect(inboundA.analyserNode.disconnect).toHaveBeenCalledWith(target.gainNode);
            expect(inboundA.analyserNode.disconnect).not.toHaveBeenCalledWith();
            expect(inboundA.analyserNode.connect).toHaveBeenLastCalledWith(engine.masterGainNode);
            expect(inboundB.analyserNode.connect).toHaveBeenLastCalledWith(engine.masterGainNode);
            expect(unrelatedSendGain.disconnect).not.toHaveBeenCalled();
            expect(unrelatedSidechainGain.disconnect).not.toHaveBeenCalled();
        });

        it('disconnects and forgets the source track sends when the track is removed', () => {
            engine.ensureTrackStrip('src');
            engine.setSend('src', 'busA', 0.5);
            engine.setSend('src', 'busB', 0.5);

            // The two send GainNodes are the createGain() calls made by setSend.
            const sendGains = mockCtx.createGain.mock.results
                .map((r) => r.value as { disconnect: Mock })
                .filter((node) => node.disconnect.mock.calls.length === 0);
            const sendCountBefore = sendGains.length;
            expect(sendCountBefore).toBeGreaterThanOrEqual(2);

            engine.removeTrackStrip('src');

            // Re-creating a send to the same key proves the old entry was swept:
            // a leaked entry would be reused (setTargetAtTime path) instead of
            // building a fresh GainNode.
            const createGainCallsBeforeReSend = mockCtx.createGain.mock.calls.length;
            engine.ensureTrackStrip('src');
            engine.setSend('src', 'busA', 0.7);
            const createGainCallsAfterReSend = mockCtx.createGain.mock.calls.length;
            expect(createGainCallsAfterReSend).toBeGreaterThan(createGainCallsBeforeReSend);
        });

        it('clamps the initial gain of a brand-new send to [0,1] (Observation 10)', () => {
            engine.ensureTrackStrip('clampSrc');

            // A fresh send with an out-of-range level. The create path must apply
            // the same [0,1] clamp the update path uses — not the raw level.
            engine.setSend('clampSrc', 'busHi', 1.5);
            const overGain = mockCtx.createGain.mock.results.at(-1)!.value as { gain: { value: number } };
            expect(overGain.gain.value).toBe(1);

            engine.setSend('clampSrc', 'busLo', -0.5);
            const underGain = mockCtx.createGain.mock.results.at(-1)!.value as { gain: { value: number } };
            expect(underGain.gain.value).toBe(0);
        });

        it('disconnects the source track sidechain gain when the track is removed', () => {
            // Wire a sidechain whose target device is a sidechain compressor.
            const srcStrip = engine.ensureTrackStrip('scSrc');
            const tgtStrip = engine.ensureTrackStrip('scTgt');
            const deviceInput = makeStripNode();
            tgtStrip.deviceNodes.push({
                deviceId: 'dev1',
                type: 'builtin-sidechain-compressor',
                inputNode: deviceInput as unknown as AudioNode,
            } as never);

            engine.wireSidechainRoute('scSrc', 'scTgt', 'dev1');

            // The sidechain GainNode is the most recent createGain() result.
            const scGain = mockCtx.createGain.mock.results.at(-1)!.value as { disconnect: Mock };
            const scKeyDelay = mockCtx.createDelay.mock.results.at(-1)!.value;
            expect(scGain.disconnect).not.toHaveBeenCalled();

            engine.removeTrackStrip('scSrc');
            expect(scGain.disconnect).toHaveBeenCalled();
            // FX-5 — teardown drops both new edges: the tap→delay edge and the
            // delay's own outgoing edge, so the alignment line cannot outlive it.
            expect(srcStrip.analyserNode.disconnect).toHaveBeenCalledWith(scKeyDelay);
            expect(scKeyDelay.disconnect).toHaveBeenCalled();

            // Re-wiring proves the entry was deleted (no early `has(key)` return).
            engine.ensureTrackStrip('scSrc');
            const createGainBefore = mockCtx.createGain.mock.calls.length;
            engine.wireSidechainRoute('scSrc', 'scTgt', 'dev1');
            expect(mockCtx.createGain.mock.calls.length).toBeGreaterThan(createGainBefore);

            void srcStrip;
        });

        it('disconnects a sidechain targeting a removed device and permits rewiring the same route key', () => {
            const sourceStrip = engine.ensureTrackStrip('scSrc');
            const targetStrip = engine.ensureTrackStrip('scTgt');
            targetStrip.deviceNodes.push({
                deviceId: 'dev1',
                type: 'builtin-sidechain-compressor',
                inputNode: makeStripNode() as unknown as AudioNode,
            } as never);
            engine.wireSidechainRoute('scSrc', 'scTgt', 'dev1');
            const oldSidechainGain = mockCtx.createGain.mock.results.at(-1)!.value as { disconnect: Mock };
            const oldKeyDelay = mockCtx.createDelay.mock.results.at(-1)!.value;

            engine.removeTrackStrip('scTgt');

            expect(oldSidechainGain.disconnect).toHaveBeenCalledTimes(1);
            expect(sourceStrip.analyserNode.disconnect).toHaveBeenCalledWith(oldKeyDelay);
            const replacementTarget = engine.ensureTrackStrip('scTgt');
            replacementTarget.deviceNodes.push({
                deviceId: 'dev1',
                type: 'builtin-sidechain-compressor',
                inputNode: makeStripNode() as unknown as AudioNode,
            } as never);
            const createGainBeforeRewire = mockCtx.createGain.mock.calls.length;
            engine.wireSidechainRoute('scSrc', 'scTgt', 'dev1');
            expect(mockCtx.createGain.mock.calls.length).toBe(createGainBeforeRewire + 1);
        });

        it('detaches both sidechain ends when route unwiring precedes source strip removal', () => {
            const sourceStrip = engine.ensureTrackStrip('ordered-source');
            const targetStrip = engine.ensureTrackStrip('ordered-target');
            targetStrip.deviceNodes.push({
                deviceId: 'ordered-device',
                type: 'builtin-sidechain-compressor',
                inputNode: makeStripNode() as unknown as AudioNode,
            } as never);
            engine.wireSidechainRoute('ordered-source', 'ordered-target', 'ordered-device');
            const sidechainGain = mockCtx.createGain.mock.results.at(-1)!.value as { disconnect: Mock };
            const keyDelay = mockCtx.createDelay.mock.results.at(-1)!.value;

            engine.unwireSidechainRoute('ordered-source', 'ordered-device');
            engine.removeTrackStrip('ordered-source');

            expect(sourceStrip.analyserNode.disconnect).toHaveBeenCalledWith(keyDelay);
            // Still exactly one teardown: the strip removal must not re-detach a
            // route the explicit unwire already dropped.
            expect(sidechainGain.disconnect).toHaveBeenCalledTimes(1);
            expect(keyDelay.disconnect).toHaveBeenCalledTimes(1);
        });

        it('forgets pending sidechains owned by a removed source, target track, or target device', () => {
            const fallbackEngine = makeFallbackEngine();
            const removedStrip = fallbackEngine.ensureTrackStrip('removed');
            removedStrip.deviceNodes.push({ deviceId: 'owned-device' } as never);

            fallbackEngine.wireSidechainRoute('removed', 'other-target', 'other-device');
            fallbackEngine.wireSidechainRoute('other-source-a', 'removed', 'missing-device');
            fallbackEngine.wireSidechainRoute('other-source-b', 'wrong-target', 'owned-device');
            fallbackEngine.wireSidechainRoute('kept-source', 'kept-target', 'kept-device');
            expect(getPendingSidechainRoutes(fallbackEngine).size).toBe(4);

            fallbackEngine.removeTrackStrip('removed');

            expect(Array.from(getPendingSidechainRoutes(fallbackEngine).keys())).toEqual(['kept-source→kept-device']);
        });

        it('forgets pending routes for an absent source or target strip', () => {
            const fallbackEngine = makeFallbackEngine();
            fallbackEngine.wireSidechainRoute('absent-source', 'kept-target', 'source-device');
            fallbackEngine.wireSidechainRoute('kept-source', 'absent-target', 'target-device');
            fallbackEngine.wireSidechainRoute('kept-source', 'kept-target', 'kept-device');

            fallbackEngine.removeTrackStrip('absent-source');
            fallbackEngine.removeTrackStrip('absent-target');

            expect(Array.from(getPendingSidechainRoutes(fallbackEngine).keys())).toEqual(['kept-source→kept-device']);
        });
    });

    // ── Fix 4: a rejected addModule must not poison initialize() forever ─────────
    describe('worklet load is retryable', () => {
        it('does not cache a rejection and surfaces lastInitError, then succeeds on retry', async () => {
            mockCtx.audioWorklet.addModule.mockRejectedValueOnce(new Error('404 worklet'));

            await expect(engine.initialize()).rejects.toThrow('404 worklet');
            expect(engine.getHealth().lastInitError?.message).toContain('404 worklet');
            expect(engine.getHealth().workletReady).toBe(false);

            // Next attempt re-runs the load (the poisoned promise was cleared).
            await expect(engine.initialize()).resolves.toBeUndefined();
            expect(engine.getHealth().workletReady).toBe(true);
            expect(engine.getHealth().lastInitError).toBeNull();
        });

        it('shares one in-flight load across concurrent callers', async () => {
            const callsBefore = mockCtx.audioWorklet.addModule.mock.calls.length;
            await Promise.all([engine.initialize(), engine.initialize()]);
            const callsAfter = mockCtx.audioWorklet.addModule.mock.calls.length;
            // Six modules loaded exactly once despite two callers.
            expect(callsAfter - callsBefore).toBe(6);
        });
    });

    // ── Fix 5: resume() must surface failure, not catch-and-resolve ──────────────
    describe('resume failure handling', () => {
        it('rejects and records lastResumeError when the context resume rejects', async () => {
            mockCtx.state = 'suspended';
            mockCtx.resume.mockRejectedValueOnce(new Error('resume blocked'));

            await expect(engine.resume()).rejects.toThrow('resume blocked');
            expect(engine.getHealth().lastResumeError?.message).toContain('resume blocked');
        });

        it('clears lastResumeError on a subsequent successful resume', async () => {
            mockCtx.state = 'suspended';
            mockCtx.resume.mockRejectedValueOnce(new Error('resume blocked'));
            await expect(engine.resume()).rejects.toThrow();

            mockCtx.state = 'suspended';
            mockCtx.resume.mockResolvedValueOnce(undefined);
            await expect(engine.resume()).resolves.toBeUndefined();
            expect(engine.getHealth().lastResumeError).toBeNull();
        });
    });

    // ── Fix 2: dispose() teardown contract ───────────────────────────────────────
    describe('dispose', () => {
        it('awaits context.close, makes disposal terminal, and releases the transport SAB', async () => {
            await engine.initialize();
            expect(engine.getHealth().workletReady).toBe(true);
            const masterMeterPort = (engine as unknown as { masterMeterNode: { port: { postMessage: Mock } } })
                .masterMeterNode.port;
            const lateSource = mockCtx.createOscillator();

            await engine.dispose();

            expect(mockCtx.close).toHaveBeenCalledTimes(1);
            expect(masterMeterPort.postMessage).toHaveBeenCalledWith({ type: 'shutdown' });
            expect(engine.getHealth().workletReady).toBe(false);

            // SAB released: a post-dispose transport write must not throw.
            expect(() => engine.setTransportInfo(1, 120, true)).not.toThrow();

            const addModuleCallsBefore = mockCtx.audioWorklet.addModule.mock.calls.length;
            await expect(engine.initialize()).rejects.toThrow('Audio engine has been disposed');
            expect(mockCtx.audioWorklet.addModule.mock.calls.length).toBe(addModuleCallsBefore);
            expect(() => engine.ensureTrackStrip('late-track')).toThrow('Audio engine has been disposed');
            expect(() => engine.scheduleOscillator(440, 0, 1)).toThrow('Audio engine has been disposed');
            expect(() => engine.registerScheduledSource(lateSource)).toThrow('Audio engine has been disposed');
            expect(() => engine.applyAdjustmentLayerTick?.([])).toThrow('Audio engine has been disposed');
            expect(engine.getDiagnostics().graph.trackStrips).toBe(0);
            expect(engine.getDiagnostics().runtime.trackedAudioScheduledSources).toBe(0);
        });

        it('does not restore worklet state when initialization completes after disposal', async () => {
            const workletLoad = Promise.withResolvers<void>();
            mockCtx.audioWorklet.addModule.mockReturnValue(workletLoad.promise);

            const initialization = engine.initialize();
            await engine.dispose();
            await expect(initialization).rejects.toThrow('Audio engine was disposed during initialization');
            workletLoad.resolve();

            expect(engine.getHealth().workletReady).toBe(false);
            expect(engine.getDiagnostics().graph.masterMeterWorklets).toBe(0);
        });

        it('posts a shutdown message to live track worklet ports before teardown', async () => {
            const strip = engine.ensureTrackStrip('t1');
            const meterPort = (strip.meterNode as unknown as { port: { postMessage: Mock } }).port;

            await engine.dispose();

            expect(meterPort.postMessage).toHaveBeenCalledWith({ type: 'shutdown' });
        });
    });

    // ── Round-2 #6: setTransportInfo publishes a seqlock-guarded snapshot ─────────
    //
    // The transport SAB is shared with a worklet reader (kneadProcessor). Writing
    // the seven f64 fields with plain assignments lets a reader observe a snapshot
    // torn across the writes. setTransportInfo must instead bracket the field
    // writes with a sequence counter (Int32 view) bumped odd-before / even-after,
    // so a reader retrying on odd/changed counters never consumes a torn snapshot.
    describe('setTransportInfo seqlock (torn-read guard)', () => {
        // Int32 index of the seqlock counter; mirrors TRANSPORT_SEQ_I32 in the impl
        // and TRANSPORT_SEQ_I32 in services/kneadProcessor.ts.
        const SEQ_I32 = 14;
        const F64 = { beat: 0, tempo: 1, sampleRate: 2, loopStart: 3, loopEnd: 4, isPlaying: 5, isLooping: 6 };

        // The engine allocates its own transport SAB internally. We recover it by
        // spying on the Int32Array the constructor wraps over that buffer (the seq
        // view), then read the data fields through a Float64Array over the same
        // buffer — exactly the two views the writer and the worklet reader share.
        let capturedBuffer: ArrayBufferLike | null = null;
        function captureTransportBuffer(): ArrayBufferLike {
            expect(capturedBuffer).not.toBeNull();
            return capturedBuffer!;
        }
        let OriginalInt32Array: typeof Int32Array;

        beforeEach(() => {
            OriginalInt32Array = Int32Array;
            capturedBuffer = null;
            // Capture the buffer the engine wraps with its seq Int32Array. The
            // engine constructs Float64Array first, then Int32Array, over the same
            // SAB; we record the buffer from the Int32Array construction.
            class SpyInt32Array extends OriginalInt32Array {
                constructor(...args: unknown[]) {
                    // @ts-expect-error spread into the typed-array constructor
                    super(...args);
                    // The transport SAB is the only 64-byte buffer the constructor
                    // wraps with an Int32Array; ignore any other typed-array builds.
                    if (args[0] instanceof ArrayBuffer && args[0].byteLength === 64) {
                        capturedBuffer = args[0];
                    }
                }
            }
            vi.stubGlobal('Int32Array', SpyInt32Array);
            engine = createAudioEngine(asAudioContext(mockCtx));
            vi.stubGlobal('Int32Array', OriginalInt32Array);
        });

        it('leaves the sequence counter even after a completed write and advances it by 2', () => {
            const buf = captureTransportBuffer();
            expect(buf).not.toBeNull();
            const seq = new Int32Array(buf);

            const before = Atomics.load(seq, SEQ_I32);
            engine.setTransportInfo(4, 130, true, 1, 5, true);
            const after = Atomics.load(seq, SEQ_I32);

            // Even after the write completes (write-in-progress is the odd state).
            expect(after % 2).toBe(0);
            // Advanced by exactly 2 (odd, then even) — one full seqlock cycle.
            expect(after - before).toBe(2);
        });

        it('publishes every field value under the settled (even) counter', () => {
            const buf = captureTransportBuffer();
            const seq = new Int32Array(buf);
            const data = new Float64Array(buf);

            engine.setTransportInfo(2.5, 90, false, 8, 16, true);

            // All seven fields carry the values passed, and the counter is settled
            // even — the combination a reader requires for a trusted snapshot.
            expect(data[F64.beat]).toBe(2.5);
            expect(data[F64.tempo]).toBe(90);
            expect(data[F64.sampleRate]).toBe(mockCtx.sampleRate);
            expect(data[F64.loopStart]).toBe(8);
            expect(data[F64.loopEnd]).toBe(16);
            expect(data[F64.isPlaying]).toBe(0);
            expect(data[F64.isLooping]).toBe(1);
            expect(Atomics.load(seq, SEQ_I32) % 2).toBe(0);
        });

        it('the engine writer produces snapshots a seqlock reader accepts as clean', () => {
            // Faithful re-implementation of the reader loop in
            // services/kneadProcessor.ts (TRANSPORT_SEQ_MAX_RETRIES path): sample
            // the fields between two Atomics.load of the counter; accept only when
            // the counter is unchanged and even. After a completed engine write the
            // reader must get the exact values on its first attempt — proving the
            // writer's seqlock output is consumable, not torn.
            const buf = captureTransportBuffer();
            const seq = new Int32Array(buf);
            const data = new Float64Array(buf);

            function seqlockRead(): { beat: number; tempo: number; playing: boolean; cleanFirstTry: boolean } {
                let beat = 0;
                let tempo = 120;
                let playing = false;
                let cleanFirstTry = false;
                for (let attempt = 0; attempt <= 8; attempt++) {
                    const start = Atomics.load(seq, SEQ_I32);
                    beat = data[F64.beat] ?? 0;
                    tempo = data[F64.tempo] ?? 120;
                    playing = (data[F64.isPlaying] ?? 0) > 0.5;
                    const end = Atomics.load(seq, SEQ_I32);
                    if (start === end && (start & 1) === 0) {
                        cleanFirstTry = attempt === 0;
                        break;
                    }
                }
                return { beat, tempo, playing, cleanFirstTry };
            }

            const seqBeforeWrites = Atomics.load(seq, SEQ_I32);

            engine.setTransportInfo(42, 128, true, 0, 0, false);
            const r1 = seqlockRead();
            expect(r1.cleanFirstTry).toBe(true);
            expect(r1.beat).toBe(42);
            expect(r1.tempo).toBe(128);
            expect(r1.playing).toBe(true);

            engine.setTransportInfo(7, 100, false, 0, 0, false);
            const r2 = seqlockRead();
            expect(r2.cleanFirstTry).toBe(true);
            expect(r2.beat).toBe(7);
            expect(r2.tempo).toBe(100);
            expect(r2.playing).toBe(false);

            // Each write must advance the seqlock counter by exactly 2 (odd→even):
            // without the protocol the counter never moves and a concurrent reader
            // has no way to detect a torn write. Two writes ⇒ +4.
            expect(Atomics.load(seq, SEQ_I32) - seqBeforeWrites).toBe(4);
        });

        it('a seqlock reader rejects a mid-write (odd-counter) snapshot as torn', () => {
            // The reader's torn-detection logic in isolation, on a buffer the test
            // fully controls (so the engine's sole-writer parity invariant is not
            // disturbed). When the counter is odd — the in-progress state the writer
            // holds between its odd and even bumps — the reader must never break out
            // accepting the snapshot, even after exhausting its retry bound.
            const standalone = new ArrayBuffer(64);
            const seq = new Int32Array(standalone);
            const data = new Float64Array(standalone);

            // Mid-write: odd counter, a torn/partial field value.
            Atomics.store(seq, SEQ_I32, 1);
            data[F64.beat] = 999;

            let accepted = false;
            for (let attempt = 0; attempt <= 8; attempt++) {
                const start = Atomics.load(seq, SEQ_I32);
                const _beat = data[F64.beat] ?? 0;
                void _beat;
                const end = Atomics.load(seq, SEQ_I32);
                if (start === end && (start & 1) === 0) {
                    accepted = true;
                    break;
                }
            }
            expect(accepted).toBe(false);

            // Once the write completes (counter bumped to the next even value), the
            // same reader accepts the now-consistent snapshot.
            Atomics.store(seq, SEQ_I32, 2);
            data[F64.beat] = 12;
            let cleanBeat = 0;
            for (let attempt = 0; attempt <= 8; attempt++) {
                const start = Atomics.load(seq, SEQ_I32);
                cleanBeat = data[F64.beat] ?? 0;
                const end = Atomics.load(seq, SEQ_I32);
                if (start === end && (start & 1) === 0) {
                    break;
                }
            }
            expect(cleanBeat).toBe(12);
        });
    });

    // ── Round-2 #8: device/param methods no-op in fallback mode ───────────────────
    //
    // In fallbackMode the engine runs on an OfflineAudioContext/noop shim. The
    // device + MIDI-FX methods previously built nodes on that shim instead of
    // no-opping like the already-guarded methods. They must short-circuit on
    // `if (this.fallbackMode) return` so no graph work happens on the shim.
    describe('fallbackMode device-method guards', () => {
        let fbEngine: AudioEngine;

        beforeEach(() => {
            // Force the constructor's AudioContext path to throw → fallbackMode.
            // setupNoopContext then builds the engine on an OfflineAudioContext.
            class FailingAudioContext {
                constructor() {
                    throw new Error('no AudioContext in this environment');
                }
            }
            vi.stubGlobal('AudioContext', FailingAudioContext);
            vi.stubGlobal(
                'OfflineAudioContext',
                class {
                    createGain() {
                        return { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
                    }
                    createAnalyser() {
                        return { connect: vi.fn(), disconnect: vi.fn(), frequencyBinCount: 1 };
                    }
                }
            );
            // No providedContext → ctor tries `new AudioContext(...)`, which throws.
            fbEngine = createAudioEngine();
        });

        it('reports fallback state (engine did not get a live context)', () => {
            expect(fbEngine.getState().isReady).toBe(false);
            expect(fbEngine.getState().state).toBe('closed');
            const actual = fbEngine.getDiagnostics();
            expect(actual.context).toEqual({
                state: 'closed',
                sampleRate: 44_100,
                baseLatency: 0,
                outputLatency: 0,
                latencyProfile: 'lowLatency',
                latencyHint: 'interactive',
            });
            expect(actual.playback).toBeNull();
        });

        it('reports audio as unavailable on the shim and available on a live context', () => {
            // The shim's nodes are structurally real, so a consumer that inspects
            // one — connecting a tap, reading the context state — cannot tell the
            // two apart. This read is the only thing that can.
            expect(fbEngine.isAudioAvailable()).toBe(false);
            expect(createAudioEngine(asAudioContext(createMockAudioContext())).isAudioAvailable()).toBe(true);
        });

        it('does not report fallback shim strips as a live graph', () => {
            fbEngine.ensureTrackStrip('track-1');
            fbEngine.ensureBusStrip('bus-1');

            expect(fbEngine.getDiagnostics().graph).toEqual({
                trackStrips: 0,
                busStrips: 0,
                sends: 0,
                sidechains: 0,
                deviceInstances: 0,
                pendingDeviceInstances: 0,
                failedDeviceInstances: 0,
                deviceInstancesByType: {},
                deviceAudioNodes: 0,
                graphSlotResourcesByLoadState: {
                    ready: { audioNodes: 0, audioWorkletProcessors: 0, workers: 0 },
                    pending: { audioNodes: 0, audioWorkletProcessors: 0, workers: 0 },
                    failed: { audioNodes: 0, audioWorkletProcessors: 0, workers: 0 },
                },
                deviceAudioWorkletProcessors: 0,
                deviceAudioWorkletProcessorsByType: {},
                stripMeterWorklets: 0,
                masterMeterWorklets: 0,
                graphAudioWorkletProcessors: 0,
                workerInstances: 0,
                workerInstancesByType: {},
                adjustmentLayerBuses: 0,
                adjustmentLayerBusesByEffectType: {},
                adjustmentLayerAudioNodes: 0,
                adjustmentLayerAudioWorkletProcessors: 0,
            });
        });

        it('addDeviceToStrip does not build a track node on the shim in fallback mode', () => {
            // A guarded no-op means no strip is ever materialized for the track.
            fbEngine.addDeviceToStrip('t1', 'dev1', 'builtin-gain');
            expect(fbEngine.getTrackStrip('t1')).toBeUndefined();
        });

        it('device + MIDI-FX param methods do not forward to a strip in fallback mode', () => {
            // Materialize a strip on the shim (ensureTrackStrip is outside the
            // guarded device-method scope, so it still creates one in fallback).
            // The mock TrackNode deliberately lacks updateParam/addDevice/etc., so
            // an UNGUARDED method that forwards to the strip throws a TypeError.
            // A correctly guarded method returns before touching the strip → no
            // throw. This is the regression signal: each method must short-circuit.
            fbEngine.ensureTrackStrip('t1');
            expect(fbEngine.getTrackStrip('t1')).toBeDefined();

            expect(() => fbEngine.updateDeviceParam('t1', 'dev1', 'p', 0.5)).not.toThrow();
            expect(() => fbEngine.updateDevicePatch('t1', 'dev1', { p: 1 })).not.toThrow();
            expect(() => fbEngine.removeDeviceFromStrip('t1', 'dev1')).not.toThrow();
            expect(() => fbEngine.scheduleDeviceParam('t1', 'dev1', 'p', 0.5, 0)).not.toThrow();
            expect(() => fbEngine.scheduleDeviceKeyOn('t1', 'dev1', 60, 100)).not.toThrow();
            expect(() => fbEngine.scheduleDeviceKeyOff('t1', 'dev1', 60, 100)).not.toThrow();
            expect(() => fbEngine.updateDeviceBypass('t1', 'dev1', true)).not.toThrow();
            expect(() => fbEngine.addMidiFxToStrip('t1', 'fx1', 'arp')).not.toThrow();
            expect(() => fbEngine.removeMidiFxFromStrip('t1', 'fx1')).not.toThrow();
            expect(() => fbEngine.updateMidiFxParam('t1', 'fx1', 'p', 0.5)).not.toThrow();
            expect(() => fbEngine.updateMidiFxBypass('t1', 'fx1', true)).not.toThrow();
        });

        it('lifecycle, transport and meter methods short-circuit without touching the noop graph', async () => {
            // initialize / resume / suspend are no-ops in fallback mode.
            await expect(fbEngine.initialize()).resolves.toBeUndefined();
            await expect(fbEngine.resume()).resolves.toBeUndefined();
            await expect(fbEngine.suspend()).resolves.toBeUndefined();

            // Master gain setters/readers return the fallback defaults without
            // ramping on the noop context.
            expect(() => fbEngine.setMasterGain(0.5)).not.toThrow();
            expect(fbEngine.getMasterGain()).toBe(0);
            // No live graph at all, so there is nothing to meter — "unavailable",
            // not "silent". The status bar renders `null` as "n/a" rather than
            // "-∞ dB", which would claim a measurement was taken.
            expect(fbEngine.getMasterPeakLevel()).toBeNull();

            // Transport / metering guards — each must return before touching the
            // noop graph; an unguarded method would dereference a noop node and
            // throw. No throw is the regression signal.
            expect(() => fbEngine.cancelTrackAutomationRamps()).not.toThrow();
            expect(() => fbEngine.registerTuningTable([440])).not.toThrow();
            expect(() => fbEngine.setSend('t1', 'bus1', 0.5)).not.toThrow();
            expect(() => fbEngine.refreshSidechainAlignment(() => 0)).not.toThrow();
            expect(() => fbEngine.scheduleOscillator(440, 0, 0.1, 0.3)).not.toThrow();
            expect(() => fbEngine.scheduleClick(0, true, 1)).not.toThrow();
            expect(() => fbEngine.stopAllScheduled()).not.toThrow();
            expect(() => fbEngine.syncKneadState('t1', {})).not.toThrow();
        });
    });

    it('maps the high-capacity product profile to Chrome playback latency and reports the request', () => {
        const constructorOptions = vi.fn();
        class ProfiledAudioContext {
            constructor(options: AudioContextOptions) {
                constructorOptions(options);
                return mockCtx;
            }
        }
        vi.stubGlobal('AudioContext', ProfiledAudioContext);
        window.localStorage.setItem(
            'sourdaw-preferences',
            JSON.stringify({ json: { preferencesSchemaVersion: 2, audioLatencyProfile: 'highCapacity' } })
        );

        const profiledEngine = createAudioEngine();

        expect(constructorOptions).toHaveBeenCalledWith({ latencyHint: 'playback' });
        expect(profiledEngine.getDiagnostics().context).toEqual({
            state: 'running',
            sampleRate: 48_000,
            baseLatency: 0.01,
            outputLatency: 0.02,
            latencyProfile: 'highCapacity',
            latencyHint: 'playback',
        });
    });

    it('does not allocate a strip when parameter and patch executors target an absent strip', () => {
        const engine = createAudioEngine();

        expect(engine.getTrackStrip('missing-track')).toBeUndefined();

        engine.updateDeviceParam('missing-track', 'missing-device', 'gain', 0.5);
        engine.updateDevicePatch('missing-track', 'missing-device', { gain: 0.75 });

        expect(engine.getTrackStrip('missing-track')).toBeUndefined();
    });

    // ── Fix 2: sidechain wiring in fallback mode is queued, not dropped ──────────
    //
    // wireSidechainRoute used to early-return in fallback mode, silently dropping
    // the route while the store kept it — diverging the live graph with no
    // recovery. It now queues the route (without touching the noop graph) for
    // replay on the next non-fallback wire, while unwire cancels a still-pending
    // route. These tests guard the observable engine-side behavior: fallback
    // wiring must not crash or corrupt the noop graph, and the ready path must
    // keep wiring as before. The discriminating queue-vs-drop + recoverable-state
    // contract is proven through the public caller in setSidechainRoutes.spec.ts.
    describe('sidechain fallback queue and replay', () => {
        it('does not wire onto the noop graph and does not throw when requested in fallback mode', () => {
            const fb = makeFallbackEngine();
            const createGain = (fb as unknown as { __createGain: Mock }).__createGain;
            // setupNoopContext builds one gain node (master). Wiring a sidechain
            // must not build another — the route is queued, not applied.
            const gainCallsAfterSetup = createGain.mock.calls.length;

            expect(() => fb.wireSidechainRoute('src', 'dst', 'dev1')).not.toThrow();
            expect(createGain.mock.calls.length).toBe(gainCallsAfterSetup);

            // Unwire of a still-pending route is a clean no-op (cancels the queue).
            expect(() => fb.unwireSidechainRoute('src', 'dev1')).not.toThrow();
        });

        it('still wires a valid route on a ready engine (replay-drain is harmless when empty)', () => {
            const tgtStrip = engine.ensureTrackStrip('scTgt');
            engine.ensureTrackStrip('scSrc');
            tgtStrip.deviceNodes.push({
                deviceId: 'dev1',
                type: 'builtin-sidechain-compressor',
                inputNode: makeStripNode() as unknown as AudioNode,
            } as never);

            const createGainBefore = mockCtx.createGain.mock.calls.length;
            engine.wireSidechainRoute('scSrc', 'scTgt', 'dev1');
            // A new sidechain GainNode was built and wired (the path still runs).
            expect(mockCtx.createGain.mock.calls.length).toBeGreaterThan(createGainBefore);

            const scGain = mockCtx.createGain.mock.results.at(-1)!.value as { connect: Mock };
            expect(scGain.connect).toHaveBeenCalled();
        });
    });

    // ── PR #312: sidechain replay is idempotent and drops unresolvable routes ────
    //
    // wireSidechainRoutes (Routing) replays every persisted route on each
    // ensureTrackStrips run — before every playback/record start — so the engine
    // paths it exercises must be safe to re-run: a route that is already wired
    // must not double-connect (the `sidechainConnections.has(key)` dedupe), and
    // a route whose target strip/device does not exist must be dropped without
    // throwing (applySidechainRoute's guards), never crashing strip setup.
    describe('sidechain replay idempotency and missing-target drop', () => {
        function pushSidechainDevice(targetStrip: { deviceNodes: unknown[] }, deviceId: string) {
            targetStrip.deviceNodes.push({
                deviceId,
                type: 'builtin-sidechain-compressor',
                inputNode: makeStripNode() as unknown as AudioNode,
            });
        }

        it('wiring the same route twice creates exactly one sidechain connection', () => {
            const tgtStrip = engine.ensureTrackStrip('scTgt');
            const srcStrip = engine.ensureTrackStrip('scSrc');
            pushSidechainDevice(tgtStrip, 'dev1');

            const createGainBefore = mockCtx.createGain.mock.calls.length;
            engine.wireSidechainRoute('scSrc', 'scTgt', 'dev1');
            // First wire builds exactly one sidechain GainNode off the source tap.
            expect(mockCtx.createGain.mock.calls.length).toBe(createGainBefore + 1);
            const connectCallsAfterFirst = (srcStrip.analyserNode.connect as Mock).mock.calls.length;

            // Replay (second wire of the identical route) must hit the
            // `sidechainConnections.has(key)` dedupe: no new GainNode, no new
            // connection off the source tap — a pure no-op.
            engine.wireSidechainRoute('scSrc', 'scTgt', 'dev1');
            expect(mockCtx.createGain.mock.calls.length).toBe(createGainBefore + 1);
            expect((srcStrip.analyserNode.connect as Mock).mock.calls.length).toBe(connectCallsAfterFirst);
        });

        it('drops a route whose target strip is absent without throwing or building nodes', () => {
            engine.ensureTrackStrip('scSrc');

            const createGainBefore = mockCtx.createGain.mock.calls.length;
            expect(() => engine.wireSidechainRoute('scSrc', 'missing-target', 'dev1')).not.toThrow();
            expect(mockCtx.createGain.mock.calls.length).toBe(createGainBefore);
        });

        it('drops a route whose source strip is absent without throwing or building nodes', () => {
            const tgtStrip = engine.ensureTrackStrip('scTgt');
            pushSidechainDevice(tgtStrip, 'dev1');

            const createGainBefore = mockCtx.createGain.mock.calls.length;
            expect(() => engine.wireSidechainRoute('missing-source', 'scTgt', 'dev1')).not.toThrow();
            expect(mockCtx.createGain.mock.calls.length).toBe(createGainBefore);
        });

        it('drops a route whose target device is absent (or not a sidechain compressor) without throwing', () => {
            engine.ensureTrackStrip('scSrc');
            const tgtStrip = engine.ensureTrackStrip('scTgt');

            // No device at all on the target strip.
            const createGainBefore = mockCtx.createGain.mock.calls.length;
            expect(() => engine.wireSidechainRoute('scSrc', 'scTgt', 'missing-dev')).not.toThrow();
            expect(mockCtx.createGain.mock.calls.length).toBe(createGainBefore);

            // A device with the right id but the wrong type is also rejected.
            tgtStrip.deviceNodes.push({
                deviceId: 'not-a-compressor',
                type: 'builtin-gain',
                inputNode: makeStripNode() as unknown as AudioNode,
            } as never);
            expect(() => engine.wireSidechainRoute('scSrc', 'scTgt', 'not-a-compressor')).not.toThrow();
            expect(mockCtx.createGain.mock.calls.length).toBe(createGainBefore);
        });
    });

    // ── FX-5: the sidechain key alignment line follows the resolved PDC value ───
    describe('sidechain key alignment', () => {
        type KeyDelayNode = {
            delayTime: { cancelScheduledValues: Mock; setValueAtTime: Mock; linearRampToValueAtTime: Mock };
        };

        function wireKeyedRoute(): KeyDelayNode {
            const targetStrip = engine.ensureTrackStrip('scTgt');
            engine.ensureTrackStrip('scSrc');
            targetStrip.deviceNodes.push({
                deviceId: 'dev1',
                type: 'builtin-sidechain-compressor',
                inputNode: makeStripNode() as unknown as AudioNode,
            } as never);
            engine.wireSidechainRoute('scSrc', 'scTgt', 'dev1');
            return mockCtx.createDelay.mock.results.at(-1)!.value;
        }

        it('ramps the key delay onto the resolved alignment instead of stepping it', () => {
            const { delayTime } = wireKeyedRoute();

            engine.refreshSidechainAlignment(() => 0.03);

            // Anchor-then-ramp, the same idiom the automation writes use: stale
            // events dropped, current value pinned, then an a-rate glide to the
            // target. A bare setValueAtTime here would click the key.
            expect(delayTime.cancelScheduledValues).toHaveBeenCalled();
            expect(delayTime.setValueAtTime).toHaveBeenCalled();
            const [rampValue, rampTime] = delayTime.linearRampToValueAtTime.mock.calls.at(-1)!;
            expect(rampValue).toBeCloseTo(0.03, 10);
            expect(rampTime).toBeGreaterThan(mockCtx.currentTime);
        });

        it('passes the wired route identity to the resolver', () => {
            wireKeyedRoute();
            const keyDelayFor = vi.fn(() => 0.01);

            engine.refreshSidechainAlignment(keyDelayFor);

            expect(keyDelayFor).toHaveBeenCalledWith({
                sourceTrackId: 'scSrc',
                targetTrackId: 'scTgt',
                targetDeviceId: 'dev1',
            });
        });

        it('follows a mid-session latency change down as well as up', () => {
            const { delayTime } = wireKeyedRoute();

            engine.refreshSidechainAlignment(() => 0.03);
            engine.refreshSidechainAlignment(() => 0.008);

            const [rampValue] = delayTime.linearRampToValueAtTime.mock.calls.at(-1)!;
            expect(rampValue).toBeCloseTo(0.008, 10);
            expect(delayTime.linearRampToValueAtTime).toHaveBeenCalledTimes(2);
        });

        it('schedules nothing when the resolved alignment has not moved', () => {
            const { delayTime } = wireKeyedRoute();

            engine.refreshSidechainAlignment(() => 0.03);
            const rampsAfterFirst = delayTime.linearRampToValueAtTime.mock.calls.length;
            // The refresh runs once per scheduler tick; an unchanged alignment
            // must not churn AudioParam events on every one of them.
            engine.refreshSidechainAlignment(() => 0.03);
            engine.refreshSidechainAlignment(() => 0.03);

            expect(delayTime.linearRampToValueAtTime.mock.calls.length).toBe(rampsAfterFirst);
        });

        it('clamps a negative resolution to zero rather than writing it', () => {
            const { delayTime } = wireKeyedRoute();

            engine.refreshSidechainAlignment(() => 0.03);
            engine.refreshSidechainAlignment(() => -0.5);

            const [rampValue] = delayTime.linearRampToValueAtTime.mock.calls.at(-1)!;
            expect(rampValue).toBe(0);
        });

        it('stops driving a route once it is unwired', () => {
            const { delayTime } = wireKeyedRoute();
            engine.refreshSidechainAlignment(() => 0.03);
            const rampsWhileWired = delayTime.linearRampToValueAtTime.mock.calls.length;

            engine.unwireSidechainRoute('scSrc', 'dev1');
            engine.refreshSidechainAlignment(() => 0.05);

            expect(delayTime.linearRampToValueAtTime.mock.calls.length).toBe(rampsWhileWired);
        });
    });

    // ── Fix 3: pre/post-fader send-tap toggle crossfades (no silence gap) ────────
    //
    // Toggling a live send between the pre- and post-fader tap used to hard
    // disconnect() the send gain and then connect() the new tap across two
    // synchronous Web Audio calls — leaving the bus with no input for one render
    // quantum (~2.7ms), an audible drop on a pumping bus. The toggle must now
    // equal-time-crossfade: build a fresh gain on the new tap ramping 0→level
    // while the old gain ramps level→0 over the same ~10ms window, so the bus is
    // continuously fed, and only tear the old node down after the ramp.
    describe('pre/post-fader send-tap crossfade', () => {
        function setupSend(): { disconnect: Mock; gain: { linearRampToValueAtTime: Mock } } {
            engine.ensureTrackStrip('t1');
            engine.setSend('t1', 'busA', 0.5, /* preFader */ false);
            return mockCtx.createGain.mock.results.at(-1)!.value as {
                disconnect: Mock;
                gain: { linearRampToValueAtTime: Mock };
            };
        }

        it('does not hard-disconnect the old send gain synchronously on a tap toggle', () => {
            vi.useFakeTimers();
            try {
                const firstSendGain = setupSend();
                expect(firstSendGain.disconnect).not.toHaveBeenCalled();

                // Toggle post → pre.
                engine.setSend('t1', 'busA', 0.5, /* preFader */ true);

                // The old gain must NOT be torn down in the same tick — it is
                // ramped to silence and disconnected only after the crossfade.
                expect(firstSendGain.disconnect).not.toHaveBeenCalled();
                // It ramps down to 0 (the outgoing half of the crossfade).
                expect(firstSendGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));
            } finally {
                vi.useRealTimers();
            }
        });

        it('builds a new gain on the incoming tap that ramps up from 0 to the level', () => {
            vi.useFakeTimers();
            try {
                setupSend();
                const createGainCallsBefore = mockCtx.createGain.mock.calls.length;

                engine.setSend('t1', 'busA', 0.5, /* preFader */ true);

                // A fresh gain node was built for the incoming tap.
                expect(mockCtx.createGain.mock.calls.length).toBe(createGainCallsBefore + 1);
                const newGain = mockCtx.createGain.mock.results.at(-1)!.value as {
                    connect: Mock;
                    gain: { setValueAtTime: Mock; linearRampToValueAtTime: Mock };
                };
                // Incoming half of the crossfade: start at 0, ramp up to level.
                expect(newGain.gain.setValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));
                expect(newGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.5, expect.any(Number));
                // The new gain is wired into the bus, so the bus is fed during the fade.
                expect(newGain.connect).toHaveBeenCalled();
            } finally {
                vi.useRealTimers();
            }
        });

        it('tears the old send gain down only after the crossfade window elapses', () => {
            vi.useFakeTimers();
            try {
                const firstSendGain = setupSend();

                engine.setSend('t1', 'busA', 0.5, /* preFader */ true);
                expect(firstSendGain.disconnect).not.toHaveBeenCalled();

                // Advance past the crossfade + teardown margin (10ms + 20ms).
                vi.advanceTimersByTime(40);
                expect(firstSendGain.disconnect).toHaveBeenCalledTimes(1);
            } finally {
                vi.useRealTimers();
            }
        });

        it('still ramps the level in place when the tap does not change (no crossfade)', () => {
            engine.ensureTrackStrip('t2');
            engine.setSend('t2', 'busB', 0.4, /* preFader */ false);
            const sendGain = mockCtx.createGain.mock.results.at(-1)!.value as {
                gain: { setTargetAtTime: Mock };
            };
            const createGainCallsBefore = mockCtx.createGain.mock.calls.length;

            // Same preFader: a level change must NOT build a new node (no crossfade).
            engine.setSend('t2', 'busB', 0.9, /* preFader */ false);

            expect(mockCtx.createGain.mock.calls.length).toBe(createGainCallsBefore);
            expect(sendGain.gain.setTargetAtTime).toHaveBeenCalledWith(0.9, expect.any(Number), 0.01);
        });
    });

    // ── Fix 6: dead interface members are gone ───────────────────────────────────
    describe('interface reconciliation', () => {
        it('no longer exposes the dead getTransportSAB method (it had zero callers)', () => {
            expect((engine as Record<string, unknown>).getTransportSAB).toBeUndefined();
        });

        it('does not surface the never-implemented setMasterTrackId method', () => {
            // It was declaration-only on the interface (no implementation, no
            // caller), so it was never a real method at runtime. This asserts it
            // stays absent on the concrete engine.
            expect((engine as Record<string, unknown>).setMasterTrackId).toBeUndefined();
        });
    });

    // ── Fix 1: master peak path is wired through a SAB-backed meter ───────────────
    //
    // Before, getMasterPeakLevel always returned 0: masterMeterBuffer was a plain
    // Float32Array nothing wrote to, and no metering-processor sat in the master
    // chain (masterGain → masterAnalyser → destination). initialize() must insert
    // a SAB-backed metering-processor (masterGain → meter → analyser) and point
    // masterMeterBuffer at that SAB, so getMasterPeakLevel reflects real level.
    describe('master meter wiring', () => {
        function masterMeterSab(eng: AudioEngine): ArrayBuffer {
            const meterNode = (eng as unknown as { masterMeterNode: { port: { postMessage: Mock } } }).masterMeterNode;
            const initCall = meterNode.port.postMessage.mock.calls.find(
                (c) => (c[0] as { type?: string })?.type === 'init'
            );
            expect(initCall).toBeDefined();
            return (initCall![0] as { sab: ArrayBuffer }).sab;
        }

        it('inserts a metering-processor into the master chain on initialize', async () => {
            // Before init, no meter node is wired (master nodes are built in the
            // constructor, before any worklet module is loaded).
            const beforeInit = (engine as unknown as { masterMeterNode?: unknown }).masterMeterNode;
            expect(beforeInit).toBeUndefined();

            await engine.initialize();

            const meterNode = (engine as unknown as { masterMeterNode: { connect: Mock } }).masterMeterNode;
            expect(meterNode).toBeDefined();
            // Master gain rerouted: disconnected from the analyser, then connected
            // to the meter, which connects to the analyser.
            expect(engine.masterGainNode.disconnect).toHaveBeenCalled();
            expect(engine.masterGainNode.connect as Mock).toHaveBeenCalledWith(meterNode);
            expect(meterNode.connect).toHaveBeenCalledWith(engine.masterAnalyser);
        });

        it('reports the peak the meter writes into the SAB, then resets it', async () => {
            await engine.initialize();
            const sab = masterMeterSab(engine);
            // Exactly one Float32 (the single combined-peak slot).
            expect(sab.byteLength).toBe(4);

            // Simulate the worklet writing a peak the UI then reads.
            new Float32Array(sab)[0] = 0.6;
            expect(engine.getMasterPeakLevel()).toBeCloseTo(0.6, 5);
            // Read-and-reset: a second read with no new write returns 0.
            expect(engine.getMasterPeakLevel()).toBe(0);
        });
    });

    // ── stopAllScheduled releases every device that can hold a voice ─────────────
    //
    // One `allNotesOff` per device, never a fan-out of 128 Fermenter / 16 Toaster
    // per-note messages. The sweep reads the generic `controller.allNotesOff`
    // every instrument descriptor publishes rather than a hand-kept branch per
    // device kind, so a device kind cannot be forgotten here (audit MD-6).
    describe('stopAllScheduled all-notes-off', () => {
        function pushInstrument(eng: AudioEngine, trackId: string, type: string) {
            const allNotesOff = vi.fn();
            const strip = eng.ensureTrackStrip(trackId);
            strip.deviceNodes.push({
                deviceId: `${type}-dev`,
                type,
                nodes: [],
                controller: { allNotesOff, setParam: vi.fn(), setBypass: vi.fn() },
            } as never);
            return allNotesOff;
        }

        it('releases every instrument kind exactly once through the registry control surface', () => {
            const releases = {
                fermenter: pushInstrument(engine, 'tFerm', 'fermenter'),
                toaster: pushInstrument(engine, 'tToast', 'toaster'),
                grandBoule: pushInstrument(engine, 'tGb', 'grand-boule'),
                levain: pushInstrument(engine, 'tLev', 'levain'),
                // A Faust instrument publishes only the generic controller. The
                // per-device branch this replaced had no case for it, so it was
                // the one instrument kind a stop could not silence.
                faust: pushInstrument(engine, 'tFaust', 'faust-organ'),
            };

            engine.stopAllScheduled();

            for (const release of Object.values(releases)) {
                expect(release).toHaveBeenCalledTimes(1);
            }
        });

        it('does not fan out per-note messages to an instrument worklet port', () => {
            const strip = engine.ensureTrackStrip('tFerm');
            const workletNode = new FakeWorkletNode();
            strip.deviceNodes.push({
                deviceId: 'ferm-dev',
                type: 'fermenter',
                nodes: [workletNode],
                controller: { allNotesOff: vi.fn(), setParam: vi.fn(), setBypass: vi.fn() },
            } as never);

            engine.stopAllScheduled();

            const noteOffs = workletNode.port.postMessage.mock.calls.filter(
                (c) => (c[0] as { type?: string })?.type === 'noteOff'
            );
            expect(noteOffs.length).toBe(0);
        });

        it('leaves an effect with no release surface alone', () => {
            const setParam = vi.fn();
            const strip = engine.ensureTrackStrip('tEq');
            strip.deviceNodes.push({
                deviceId: 'eq-dev',
                type: 'builtin-eq',
                nodes: [],
                controller: { setParam, setBypass: vi.fn() },
            } as never);

            expect(() => engine.stopAllScheduled()).not.toThrow();
            expect(setParam).not.toHaveBeenCalled();
        });

        it('stops a registered scheduled source, which the built-in synth path used to leak', () => {
            // Bare oscillators the scheduler writes into a strip had no handle
            // anywhere, so nothing could silence them before their programmed
            // stop time (audit MD-6).
            const stop = vi.fn();
            const source = { stop, addEventListener: vi.fn() } as unknown as AudioScheduledSourceNode;

            engine.registerScheduledSource(source);
            engine.stopAllScheduled();

            expect(stop).toHaveBeenCalledTimes(1);
        });

        it('drops a registered source once it ends so the tracking list stays bounded', () => {
            const stop = vi.fn();
            let endedListener: (() => void) | undefined;
            const source = {
                stop,
                addEventListener: (_event: string, listener: () => void) => {
                    endedListener = listener;
                },
            } as unknown as AudioScheduledSourceNode;

            engine.registerScheduledSource(source);
            endedListener?.();
            engine.stopAllScheduled();

            expect(stop).not.toHaveBeenCalled();
        });
    });

    // ── findToasterControls: deviceId-keyed port for foreign modules (Toaster) ────
    //
    // Owns the strip/device-node traversal so Toaster resolves a loaded device's
    // control surface without touching getTrackStrip(...).deviceNodes internals.
    describe('findToasterControls', () => {
        function pushDevice(eng: AudioEngine, trackId: string, deviceId: string, withControls: boolean) {
            const strip = eng.ensureTrackStrip(trackId);
            const controls = withControls ? { setParam: vi.fn(), setPadParam: vi.fn() } : undefined;
            strip.deviceNodes.push({
                deviceId,
                type: withControls ? 'toaster' : 'builtin-eq',
                nodes: [],
                ...(controls ? { toasterControls: controls } : {}),
            } as never);
            return controls;
        }

        it('selects the matching device by deviceId across multiple tracks and devices', () => {
            pushDevice(engine, 'tA', 'eq-1', false);
            const controlsB = pushDevice(engine, 'tB', 'toast-b', true);
            pushDevice(engine, 'tB', 'eq-2', false);
            const controlsC = pushDevice(engine, 'tC', 'toast-c', true);

            expect(engine.findToasterControls('toast-b')).toBe(controlsB);
            expect(engine.findToasterControls('toast-c')).toBe(controlsC);
        });

        it('returns undefined for a missing device or a device without toaster controls', () => {
            pushDevice(engine, 'tA', 'eq-1', false);

            expect(engine.findToasterControls('nope')).toBeUndefined();
            // deviceId exists but carries no toasterControls surface.
            expect(engine.findToasterControls('eq-1')).toBeUndefined();
        });
    });

    // ── Fix 6: the transport SAB allocation is guarded by hasSharedArrayBuffer ────
    //
    // The module-level singleton constructs the engine at import time. The
    // transport SAB allocation sat outside the constructor try/catch with no
    // capability guard, so `new SharedArrayBuffer(64)` threw at import on a page
    // without COOP+COEP. Construction must not throw when SAB is unavailable, and
    // setTransportInfo must no-op rather than write into a null view.
    describe('transport SAB capability guard', () => {
        it('constructs without throwing when SharedArrayBuffer is unavailable', () => {
            const savedSAB = globalThis.SharedArrayBuffer;
            // Remove the global the way a non-isolated page would.
            delete (globalThis as { SharedArrayBuffer?: unknown }).SharedArrayBuffer;
            try {
                let noSabEngine: AudioEngine | undefined;
                expect(() => {
                    noSabEngine = createAudioEngine(asAudioContext(mockCtx));
                }).not.toThrow();
                // Transport writes are a safe no-op with no SAB backing.
                expect(() => noSabEngine!.setTransportInfo(4, 120, true)).not.toThrow();
            } finally {
                vi.stubGlobal('SharedArrayBuffer', savedSAB);
            }
        });
    });

    // Guards over missing endpoints: setSend/removeBusStrip/removeSend on
    // absent targets short-circuit instead of dereferencing undefined nodes.
    describe('missing-target send/bus guards', () => {
        it('setSend ignores a source track that has no strip', () => {
            // No ensureTrackStrip('ghost') → trackNode lookup is undefined.
            engine.setSend('ghost', 'some-bus', 0.5);
            // No bus or send materialized.
            expect(engine.getTrackStrip('ghost')).toBeUndefined();
        });

        it('removeBusStrip is a clean no-op for a bus that was never created', () => {
            expect(() => engine.removeBusStrip('never-existed')).not.toThrow();
        });

        it('removeBusStrip leaves unrelated sends intact (the bus-id mismatch branch)', () => {
            // Build two buses with sends, then remove one; the send to the other
            // must survive (the false arm of `send.busId === busId`).
            engine.ensureTrackStrip('srcA');
            engine.ensureTrackStrip('srcB');
            engine.setSend('srcA', 'busA', 0.5);
            engine.setSend('srcB', 'busB', 0.5);

            engine.removeBusStrip('busA');

            // busB's send survived the sweep.
            const sends = (engine as unknown as { sendNodes: Map<string, unknown> }).sendNodes;
            const keys = Array.from(sends.keys());
            expect(keys.some((k) => k.includes('busB'))).toBe(true);
            expect(keys.some((k) => k.includes('busA'))).toBe(false);
        });

        it('removeSend tolerates an absent send key', () => {
            expect(() => engine.removeSend('no-src', 'no-bus')).not.toThrow();
        });

        it('setTrackOutput is a no-op when the track has no strip', () => {
            expect(() => engine.setTrackOutput('ghost-track', 'hw_out')).not.toThrow();
        });
    });
});
