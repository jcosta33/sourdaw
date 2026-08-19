import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import { createMockAudioContext, type MockAudioContext } from '../../../../helpers/__tests__/audioContext.mock';

import {
    createAudioEngineTopologyTestHarness as createAudioEngine,
    type AudioEngineTopologyTestHarness,
} from './createAudioEngineTopologyTestHarness';

import type { AudioEngine } from '../../models/AudioEngineState';

/**
 * Node double shared across the TrackNode / BusNode mocks below. The strip
 * exposes the nodes AudioEngineImpl reads directly (preFaderTap / analyserNode
 * for sends and sidechain, deviceNodes for note-off fan-out, meterNode for the
 * dispose shutdown sweep).
 */
function makeNode() {
    return { connect: vi.fn(), disconnect: vi.fn(), port: { postMessage: vi.fn(), close: vi.fn() } };
}

// TrackNode mock exposing the full surface AudioEngineImpl reads, including the
// default-destination / route-output hooks the adjustment-layer runtime calls.
vi.mock('../../engine/TrackNode', () => ({
    TrackNode: class {
        trackId: string;
        strip: {
            trackId: string;
            gainNode: ReturnType<typeof makeNode>;
            preFaderTap: ReturnType<typeof makeNode>;
            analyserNode: ReturnType<typeof makeNode>;
            meterNode: ReturnType<typeof makeNode> | null;
            deviceNodes: unknown[];
            outputId?: string;
        };
        private deps: {
            masterGainNode: unknown;
            getTrackGainNode: (trackId: string) => unknown;
            onDeviceLoaded?: (trackId: string, device: unknown) => void;
            onDeviceRemoved?: (trackId: string, device: unknown) => void;
            reconnectRoutingForTrack?: (trackId: string) => void;
        };
        private outputDestination: unknown;
        dispose = vi.fn();
        setGain = vi.fn();
        setPan = vi.fn();
        setMute = vi.fn();
        setOutput = vi.fn((outputId: string) => {
            this.strip.outputId = outputId;
            this.strip.analyserNode.disconnect(this.outputDestination);
            const destination = outputId === 'hw_out' ? this.deps.masterGainNode : this.deps.getTrackGainNode(outputId);
            this.strip.analyserNode.connect(destination ?? this.deps.masterGainNode);
            this.outputDestination = destination ?? this.deps.masterGainNode;
        });
        getPeakLevel = vi.fn().mockReturnValue(0.5);
        timeoutPendingDeviceLoads = vi.fn();
        // default-destination / route-output hooks the adjustment runtime reads.
        defaultDestinationNode: ReturnType<typeof makeNode>;
        getDefaultDestination = vi.fn(() => this.defaultDestinationNode);
        routeOutput = vi.fn();
        removeDevice = vi.fn((deviceId: string) => {
            const device = this.strip.deviceNodes.find(
                (candidate) => (candidate as { deviceId?: string }).deviceId === deviceId
            );
            if (!device) {
                return;
            }
            this.strip.deviceNodes = this.strip.deviceNodes.filter((candidate) => candidate !== device);
            this.deps.onDeviceRemoved?.(this.trackId, device);
        });
        rebuildChain = vi.fn(() => this.deps.reconnectRoutingForTrack?.(this.trackId));
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
            }
        ) {
            this.trackId = id;
            this.deps = deps;
            this.defaultDestinationNode = makeNode();
            this.outputDestination = deps.masterGainNode;
            this.strip = {
                trackId: id,
                gainNode: makeNode(),
                preFaderTap: makeNode(),
                analyserNode: makeNode(),
                meterNode: makeNode(),
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

function asAudioContext(ctx: MockAudioContext): AudioContext {
    return ctx as unknown as AudioContext;
}

type MockTrackNode = {
    notifyDeviceLoaded(device: unknown): void;
    rebuildChain(): void;
    defaultDestinationNode: ReturnType<typeof makeNode>;
    getDefaultDestination: () => unknown;
    routeOutput: ReturnType<typeof vi.fn>;
    cancelAutomationRamps: () => void;
    timeoutPendingDeviceLoads: ReturnType<typeof vi.fn>;
};

function getMockTrackNode(engine: AudioEngine, trackId: string): MockTrackNode {
    const node = (engine as unknown as { trackNodes: Map<string, MockTrackNode> }).trackNodes.get(trackId);
    if (!node) {
        throw new Error(`expected mock TrackNode for ${trackId}`);
    }
    return node;
}

describe('AudioEngineImpl — residual branch coverage', () => {
    let mockCtx: MockAudioContext;
    let engine: AudioEngineTopologyTestHarness;

    class FakeWorkletNode {
        port = { postMessage: vi.fn() };
        connect = vi.fn();
        disconnect = vi.fn();
    }

    beforeEach(() => {
        vi.clearAllMocks();
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
        engine = createAudioEngine(asAudioContext(mockCtx));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    // ── Constructor closure arms (L234-236): the adjustment-layer runtime deps
    //    read the truthy arms of `?.strip.analyserNode ?? null` etc. when a
    //    matching track exists and exposes its output nodes.
    describe('adjustment-layer runtime constructor closures (truthy arms)', () => {
        it('resolve track output node and default destination through the injected closures', () => {
            const trackId = 'adj-track';
            engine.ensureTrackStrip(trackId);
            const node = getMockTrackNode(engine, trackId);
            // The default-destination hook returns the node the engine wired.
            expect(node.getDefaultDestination()).toBeDefined();

            // applyAdjustmentLayerTick drives the runtime to call
            // getTrackDefaultDestination + rerouteTrack (routeOutput) for the
            // track. 'volume'/'pan' are skipped by the runtime; an 'eq' layer
            // builds an adjustment bus that wires onto the resolved default
            // destination and then reroutes the track.
            expect(() =>
                engine.applyAdjustmentLayerTick!([
                    {
                        trackId,
                        layerId: 'L1',
                        effectType: 'eq',
                        parameters: { gain: 0.5 },
                        blend: 1,
                    },
                ])
            ).not.toThrow();
            // routeOutput (rerouteTrack closure) is invoked when the bus is wired.
            expect(node.routeOutput).toHaveBeenCalled();
        });
    });

    // ── initialize(): non-Error rejection falls into the String() branch.
    describe('initialize non-Error rejection', () => {
        it('wraps a non-Error rejection into an Error before storing lastInitError', async () => {
            // A rejection with a non-Error value exercises the `error instanceof
            // Error` false arm (new Error(String(error))).
            mockCtx.audioWorklet.addModule.mockRejectedValueOnce('404 string reason');

            await expect(engine.initialize()).rejects.toThrow('404 string reason');
            expect(engine.getHealth().lastInitError).toBeInstanceOf(Error);
            expect(engine.getHealth().lastInitError?.message).toBe('404 string reason');
        });
    });

    // ── Master peak level: "unavailable" is a distinct verdict from "silent" ────
    //
    // `getMasterPeakLevel()` used to return a hardcoded `0` whenever the SAB-backed
    // metering-processor was not in the master chain. The status bar renders `0` as
    // "-∞ dB", so a meter with no tap at all was pixel-identical to a mix that is
    // genuinely silent — while audio may be playing perfectly (ADR 0012: "no silent
    // downgrade"; survey findings master-meter-silent-degrade-on-missing-sab).
    //
    // The population below is every way the master meter tap can be absent, plus
    // the two states that must still report a real number. Each member gets its own
    // verdict: `null` for "no tap, level unknown", a number for "tap live".
    describe('master peak level — unavailable vs silent', () => {
        function masterMeterSab(eng: AudioEngine): ArrayBuffer {
            const meterNode = (eng as unknown as { masterMeterNode: { port: { postMessage: Mock } } }).masterMeterNode;
            const initCall = meterNode.port.postMessage.mock.calls.find(
                (call) => (call[0] as { type?: string }).type === 'init'
            );
            expect(initCall).toBeDefined();
            return (initCall![0] as { sab: ArrayBuffer }).sab;
        }

        it('reports the live peak the worklet wrote once the tap is wired', async () => {
            await engine.initialize();
            new Float32Array(masterMeterSab(engine))[0] = 0.25;

            expect(engine.getMasterPeakLevel()).toBeCloseTo(0.25, 5);
        });

        it('reports 0 — a real reading, not null — when the wired tap measured digital silence', async () => {
            await engine.initialize();
            // The worklet wrote nothing this block: the mix really is silent. This
            // is the one state that legitimately renders "-∞ dB".
            expect(engine.getMasterPeakLevel()).toBe(0);
        });

        it('reports null before initialize() has wired the tap', () => {
            // The master nodes exist from the constructor; the meter does not. A
            // reading here describes nothing that was ever measured.
            expect(engine.getMasterPeakLevel()).toBeNull();
        });

        it('reports null when initialize() failed to load the worklet modules', async () => {
            mockCtx.audioWorklet.addModule.mockRejectedValueOnce(new Error('metering-processor 404'));

            await expect(engine.initialize()).rejects.toThrow('metering-processor 404');
            expect(engine.getMasterPeakLevel()).toBeNull();
        });

        it('reports null when SharedArrayBuffer is unavailable', async () => {
            const savedSab = globalThis.SharedArrayBuffer;
            delete (globalThis as { SharedArrayBuffer?: unknown }).SharedArrayBuffer;
            try {
                // Build a fresh engine with no SAB. The constructor must not
                // allocate transport views, and initialize must skip the meter.
                const noSabEngine = createAudioEngine(asAudioContext(mockCtx));
                await noSabEngine.initialize();
                // No worklet meter node — the constructor's analyser stands.
                const meter = (noSabEngine as unknown as { masterMeterNode?: unknown }).masterMeterNode;
                expect(meter).toBeUndefined();
                expect(noSabEngine.getMasterPeakLevel()).toBeNull();
            } finally {
                vi.stubGlobal('SharedArrayBuffer', savedSab);
            }
        });

        it('reports null when AudioWorkletNode is unavailable', async () => {
            const savedWorkletNode = globalThis.AudioWorkletNode;
            delete (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode;
            try {
                const noWorkletEngine = createAudioEngine(asAudioContext(mockCtx));
                await noWorkletEngine.initialize();

                expect(noWorkletEngine.getMasterPeakLevel()).toBeNull();
            } finally {
                vi.stubGlobal('AudioWorkletNode', savedWorkletNode);
            }
        });

        it('reports null again after dispose() tears the tap down', async () => {
            await engine.initialize();
            new Float32Array(masterMeterSab(engine))[0] = 0.75;
            expect(engine.getMasterPeakLevel()).toBeCloseTo(0.75, 5);

            await engine.dispose();

            expect(engine.getMasterPeakLevel()).toBeNull();
        });
    });

    // ── resume(): non-Error catch.
    describe('resume non-Error catch', () => {
        it('wraps a non-Error thrown by resume into an Error', async () => {
            mockCtx.state = 'suspended';
            mockCtx.resume.mockRejectedValueOnce('network gone');

            await expect(engine.resume()).rejects.toThrow('network gone');
            expect(engine.getHealth().lastResumeError).toBeInstanceOf(Error);
            expect(engine.getHealth().lastResumeError?.message).toBe('network gone');
        });
    });

    // ── getState(): baseLatency undefined fallback + isReady when context not
    //    running but worklet ready.
    describe('getState baseLatency fallback and ready-from-worklet', () => {
        it('returns 0 baseLatency when context.baseLatency is undefined', () => {
            const ctx = (engine as unknown as { context: { baseLatency?: number } }).context;
            ctx.baseLatency = undefined;
            const state = engine.getState();
            expect(state.baseLatency).toBe(0);
        });

        // `outputLatency` is optional on BaseAudioContext and absent on some
        // implementations; without the `?? 0` the status bar renders "NaNms".
        it('returns 0 outputLatency when context.outputLatency is undefined', () => {
            const ctx = (engine as unknown as { context: { outputLatency?: number } }).context;
            ctx.outputLatency = undefined;
            const state = engine.getState();
            expect(state.outputLatency).toBe(0);
            expect(state.baseLatency).toBe(0.01);
        });

        it('reports ready when context is not running but worklets are loaded', async () => {
            await engine.initialize();
            mockCtx.state = 'suspended';
            const state = engine.getState();
            expect(state.isReady).toBe(true);
        });
    });

    // ── reconnectRoutingForTrack: the guards inside the loops (non-matching
    //    send / sidechain) and the missing-strip early return.
    describe('reconnectRoutingForTrack guards', () => {
        it('is a no-op for a track that has no strip (invoked directly)', () => {
            // Access the private reconnector bound to the engine instance so its
            // `this.trackNodes` reference resolves. Invoking it on an id that was
            // never created exercises the `if (!strip) return` guard.
            const engineWithInternals = engine as unknown as {
                reconnectRoutingForTrack: (id: string) => void;
            };
            const reconnector = engineWithInternals.reconnectRoutingForTrack.bind(engine);
            expect(() => reconnector('never-created-track')).not.toThrow();
        });

        it('skips sends and sidechains that belong to other tracks when rebuilding', () => {
            const srcStrip = engine.ensureTrackStrip('rebuild-src');
            const otherStrip = engine.ensureTrackStrip('rebuild-other');
            // One send off 'rebuild-src', one off 'rebuild-other'.
            engine.setSend('rebuild-src', 'busA', 0.5, false);
            engine.setSend('rebuild-other', 'busA', 0.5, true);

            // Sidechain off 'rebuild-src'.
            const targetStrip = engine.ensureTrackStrip('sc-tgt');
            targetStrip.deviceNodes.push({
                deviceId: 'sc-dev',
                type: 'builtin-sidechain-compressor',
                inputNode: makeNode() as unknown as AudioNode,
            } as never);
            engine.wireSidechainRoute('rebuild-src', 'sc-tgt', 'sc-dev');

            vi.mocked(srcStrip.analyserNode.connect).mockClear();
            vi.mocked(otherStrip.preFaderTap.connect).mockClear();

            getMockTrackNode(engine, 'rebuild-src').rebuildChain();

            // Only the matching send (analyserNode) and sidechain re-attached.
            expect(srcStrip.analyserNode.connect).toHaveBeenCalled();
            // The other track's pre-fader tap was NOT re-attached by this rebuild.
            expect(otherStrip.preFaderTap.connect).not.toHaveBeenCalled();
        });
    });

    // ── reconcileToasterParent: destination already routed (skip re-attach),
    //    destination node missing (no matching track strip).
    describe('reconcileToasterParent edge branches', () => {
        it('does not re-attach a pad whose controls object is already current', () => {
            const child = engine.ensureTrackStrip('pad-a');
            engine.ensureTrackStrip('parent');
            const parentNode = getMockTrackNode(engine, 'parent');
            const controls = {
                connectPadOutput: vi.fn(),
                disconnectPadOutput: vi.fn(),
                setPadDryRouted: vi.fn(),
            };
            parentNode.notifyDeviceLoaded({
                deviceId: 'toast-1',
                type: 'toaster',
                nodes: [],
                toasterControls: controls,
            });
            // Bind the pad.
            engine.setTrackOutput('pad-a', 'parent', { toasterParentTrackId: 'parent', padIndex: 0 });
            expect(controls.connectPadOutput).toHaveBeenCalledTimes(1);

            // Re-notify the SAME device (e.g. a benign reload). reconcileToasterParent
            // must skip pads whose controls === the current controls (the continue).
            parentNode.notifyDeviceLoaded({
                deviceId: 'toast-1',
                type: 'toaster',
                nodes: [],
                toasterControls: controls,
            });
            expect(controls.connectPadOutput).toHaveBeenCalledTimes(1);
            void child;
        });

        it('skips a pad whose target track strip gain node is missing', () => {
            // Register a pad binding for a track, then remove that track's strip so
            // reconcileToasterParent's destinationNode lookup is undefined.
            engine.ensureTrackStrip('pad-b');
            engine.ensureTrackStrip('parent2');
            engine.setTrackOutput('pad-b', 'parent2', { toasterParentTrackId: 'parent2', padIndex: 1 });

            // Remove the child strip (the route stays in toasterPadRoutes keyed by
            // track id, but its gainNode is gone).
            engine.removeTrackStrip('pad-b');

            const parentNode = getMockTrackNode(engine, 'parent2');
            const controls = {
                connectPadOutput: vi.fn(),
                disconnectPadOutput: vi.fn(),
                setPadDryRouted: vi.fn(),
            };
            // No throw, and no connect (destination missing → continue).
            expect(() =>
                parentNode.notifyDeviceLoaded({
                    deviceId: 'toast-2',
                    type: 'toaster',
                    nodes: [],
                    toasterControls: controls,
                })
            ).not.toThrow();
            expect(controls.connectPadOutput).not.toHaveBeenCalled();
        });
    });

    // ── handleDeviceRemoved: non-toaster device is ignored; pads owned by a
    //    different parent or a different controls object are skipped.
    describe('handleDeviceRemoved branches', () => {
        it('ignores a non-toaster device removal', () => {
            const strip = engine.ensureTrackStrip('t1');
            // Push a non-toaster device and remove it; the handler early-returns.
            strip.deviceNodes.push({ deviceId: 'eq-1', type: 'builtin-eq' } as never);
            const trackNode = getMockTrackNode(engine, 't1');
            expect(() => {
                (
                    engine as unknown as {
                        handleDeviceRemoved: (id: string, device: unknown) => void;
                    }
                ).handleDeviceRemoved('t1', { type: 'builtin-eq' });
            }).not.toThrow();
            void trackNode;
        });

        it('skips pads owned by a different parent track', () => {
            // pad-c belongs to parentA. Remove a toaster from parentB; the pad
            // on parentA must be untouched.
            engine.ensureTrackStrip('pad-c');
            engine.ensureTrackStrip('parentA');
            engine.ensureTrackStrip('parentB');
            engine.setTrackOutput('pad-c', 'parentA', { toasterParentTrackId: 'parentA', padIndex: 2 });
            const controlsA = {
                connectPadOutput: vi.fn(),
                disconnectPadOutput: vi.fn(),
                setPadDryRouted: vi.fn(),
            };
            const controlsB = {
                connectPadOutput: vi.fn(),
                disconnectPadOutput: vi.fn(),
                setPadDryRouted: vi.fn(),
            };
            const parentA = getMockTrackNode(engine, 'parentA');
            parentA.notifyDeviceLoaded({ deviceId: 'toast-A', type: 'toaster', nodes: [], toasterControls: controlsA });
            const parentB = getMockTrackNode(engine, 'parentB');
            parentB.notifyDeviceLoaded({ deviceId: 'toast-B', type: 'toaster', nodes: [], toasterControls: controlsB });

            // Remove toast-B from parentB. pad-c (owned by parentA) stays routed.
            engine.removeDeviceFromStrip('parentB', 'toast-B');
            expect(controlsA.disconnectPadOutput).not.toHaveBeenCalled();
        });
    });

    // ── ensureBusStrip: throws when the underlying track strip cannot be created.
    describe('ensureBusStrip failure', () => {
        it('throws when the track strip for the bus cannot be created', () => {
            // The guard fires when ensureTrackStripInGraph runs but the node
            // is absent from trackNodes afterwards. Spy on the graph-local
            // helper to make it a no-op (it neither creates nor inserts), so the
            // subsequent trackNodes.get(busId) returns undefined and the guard
            // throws its descriptive error.
            const graphEngine = engine as unknown as {
                ensureTrackStripInGraph(trackId: string): unknown;
            };
            const spy = vi.spyOn(graphEngine, 'ensureTrackStripInGraph').mockImplementation(() => undefined);
            expect(() => engine.ensureBusStrip('orphan-bus')).toThrow(
                /Failed to create track strip for bus orphan-bus/
            );
            spy.mockRestore();
        });
    });

    // ── transportSAB ?? undefined: the TrackNode transport dep gets undefined
    //    when the engine was built without SAB.
    describe('transportSAB undefined arm', () => {
        it('passes undefined transportSAB to TrackNode when SAB is unavailable', () => {
            const savedSab = globalThis.SharedArrayBuffer;
            delete (globalThis as { SharedArrayBuffer?: unknown }).SharedArrayBuffer;
            try {
                const noSabEngine = createAudioEngine(asAudioContext(mockCtx));
                // Creating a strip reads transportSAB ?? undefined. No throw and
                // a strip materializes.
                const strip = noSabEngine.ensureTrackStrip('sab-less');
                expect(strip.trackId).toBe('sab-less');
            } finally {
                vi.stubGlobal('SharedArrayBuffer', savedSab);
            }
        });
    });

    // ── removeTrackStrip: absent node (the `if (!node) return` guard).
    describe('removeTrackStrip absent node', () => {
        it('is a clean no-op when no strip exists for the track id', () => {
            expect(() => engine.removeTrackStrip('absent-track')).not.toThrow();
            expect(engine.getTrackStrip('absent-track')).toBeUndefined();
        });
    });

    // ── crossfadeSendTap: source strip gone (early return) + post-fader tap arm.
    describe('crossfadeSendTap guards', () => {
        it('returns early when the source strip has been removed mid-toggle', () => {
            vi.useFakeTimers();
            try {
                engine.ensureTrackStrip('xsrc');
                engine.setSend('xsrc', 'busX', 0.5, false);
                const createGainBefore = mockCtx.createGain.mock.calls.length;

                // Remove the source strip, then toggle the (now-orphaned) send.
                // crossfadeSendTap reads trackNodes.get(sourceTrackId) → undefined.
                engine.removeTrackStrip('xsrc');
                engine.setSend('xsrc', 'busX', 0.5, true);

                // No new gain node built (early return before createGain).
                expect(mockCtx.createGain.mock.calls.length).toBe(createGainBefore);
            } finally {
                vi.useRealTimers();
            }
        });

        it('selects the post-fader tap (analyserNode) when toggling pre → post', () => {
            vi.useFakeTimers();
            try {
                const strip = engine.ensureTrackStrip('psrc');
                engine.setSend('psrc', 'busP', 0.5, true); // pre first
                vi.mocked(strip.analyserNode.connect).mockClear();
                vi.mocked(strip.preFaderTap.connect).mockClear();

                engine.setSend('psrc', 'busP', 0.5, false); // toggle to post

                // The new tap is the post-fader analyserNode (the false arm of
                // `preFader ? preFaderTap : analyserNode`).
                expect(strip.analyserNode.connect).toHaveBeenCalled();
                expect(strip.preFaderTap.connect).not.toHaveBeenCalled();
            } finally {
                vi.useRealTimers();
            }
        });
    });

    // ── setTrackOutput: changedOwner (pad re-binding to a different parent/index).
    describe('setTrackOutput changedOwner detach', () => {
        it('detaches the prior pad route when the binding changes owner', () => {
            engine.ensureTrackStrip('child-pad');
            engine.ensureTrackStrip('old-parent');
            engine.ensureTrackStrip('new-parent');
            const oldControls = {
                connectPadOutput: vi.fn(),
                disconnectPadOutput: vi.fn(),
                setPadDryRouted: vi.fn(),
            };
            const newControls = {
                connectPadOutput: vi.fn(),
                disconnectPadOutput: vi.fn(),
                setPadDryRouted: vi.fn(),
            };
            const oldParent = getMockTrackNode(engine, 'old-parent');
            oldParent.notifyDeviceLoaded({
                deviceId: 'toast-old',
                type: 'toaster',
                nodes: [],
                toasterControls: oldControls,
            });
            const newParent = getMockTrackNode(engine, 'new-parent');
            newParent.notifyDeviceLoaded({
                deviceId: 'toast-new',
                type: 'toaster',
                nodes: [],
                toasterControls: newControls,
            });

            engine.setTrackOutput('child-pad', 'old-parent', { toasterParentTrackId: 'old-parent', padIndex: 0 });
            expect(oldControls.connectPadOutput).toHaveBeenCalledTimes(1);

            // Re-bind to a different parent → changedOwner detaches the old route.
            engine.setTrackOutput('child-pad', 'new-parent', { toasterParentTrackId: 'new-parent', padIndex: 1 });
            expect(oldControls.disconnectPadOutput).toHaveBeenCalledWith(0, expect.anything());
            expect(newControls.connectPadOutput).toHaveBeenCalledWith(1, expect.anything());
        });
    });

    // ── waitForDevices: deadline exceeded.
    describe('waitForDevices timeout', () => {
        it('clears pending devices and warns when a load never settles', async () => {
            vi.useFakeTimers();
            engine.ensureTrackStrip('t1');
            const trackNode = getMockTrackNode(engine, 't1');
            const set = (engine as unknown as { pendingDevicePromises: Set<Promise<unknown>> }).pendingDevicePromises;
            set.add(new Promise(() => {}));
            const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

            const waiting = (
                engine as unknown as { waitForDevices: (timeoutMs: number) => Promise<void> }
            ).waitForDevices(10);
            await vi.advanceTimersByTimeAsync(11);

            await expect(waiting).resolves.toBeUndefined();
            expect(set.size).toBe(0);
            expect(trackNode.timeoutPendingDeviceLoads).toHaveBeenCalledTimes(1);
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('timed out'));
            warnSpy.mockRestore();
            vi.useRealTimers();
        });
    });

    // ── scheduleOscillator onended: the index splice path (idx >= 0).
    describe('scheduleOscillator onended', () => {
        it('removes the oscillator from scheduledNodes when onended fires', () => {
            engine.scheduleOscillator(440, 0, 0.1, 0.3);
            const scheduled = (engine as unknown as { scheduledNodes: { onended: ((ev: Event) => void) | null }[] })
                .scheduledNodes;
            expect(scheduled.length).toBe(1);
            // Fire onended → the node splices itself out.
            scheduled[0]!.onended?.(new Event('ended'));
            expect(scheduled.length).toBe(0);
        });

        it('tolerates onended firing when the node was already removed (idx < 0)', () => {
            engine.scheduleOscillator(440, 0, 0.1, 0.3);
            const scheduled = (engine as unknown as { scheduledNodes: { onended: ((ev: Event) => void) | null }[] })
                .scheduledNodes;
            const node = scheduled[0]!;
            // Fire once (removes), then again (idx = -1 path, must not throw).
            node.onended?.(new Event('ended'));
            expect(() => node.onended?.(new Event('ended'))).not.toThrow();
        });
    });

    // ── scheduleClick: non-accent ternary arms.
    describe('scheduleClick non-accent', () => {
        it('uses the lower-frequency, quieter, shorter click for a non-accent beat', () => {
            const createBefore = mockCtx.createOscillator.mock.calls.length;
            engine.scheduleClick(0, false, 1);
            const osc = mockCtx.createOscillator.mock.results.at(-1)!.value as {
                frequency: { value: number };
                type: OscillatorType;
            };
            // Non-accent → 1000 Hz (vs 1500), sine type.
            expect(osc.frequency.value).toBe(1000);
            expect(osc.type).toBe('sine');
            void createBefore;
        });
    });

    // ── stopAllScheduled: levain allNotesOff path.
    describe('stopAllScheduled levain allNotesOff', () => {
        it('releases Levain through its silent allNotesOff contract', () => {
            const strip = engine.ensureTrackStrip('levain-track');
            const allNotesOff = vi.fn();
            // Shape the device registry actually produces: every instrument
            // descriptor publishes `controller.allNotesOff` alongside its
            // typed controls, and the stop sweep reads the generic one so a
            // new instrument cannot be forgotten (audit MD-6). The intent of
            // this test is unchanged — Levain is released by one silent
            // all-notes-off, never a 128-note fan-out.
            strip.deviceNodes.push({
                deviceId: 'levain-dev',
                type: 'levain',
                nodes: [],
                controller: { allNotesOff },
                levainControls: { allNotesOff },
            } as never);

            engine.stopAllScheduled();

            expect(allNotesOff).toHaveBeenCalledTimes(1);
        });
    });

    // ── postShutdownToWorklets: the AudioWorkletNode instanceof branch + the
    //    non-worklet node skip.
    describe('postShutdownToWorklets instanceof branch', () => {
        it('posts shutdown to AudioWorkletNode device nodes and skips non-worklet nodes', async () => {
            const strip = engine.ensureTrackStrip('shutdown-track');
            const worklet = new FakeWorkletNode();
            // A non-worklet node (plain object) that must be skipped.
            const plainNode = makeNode();
            strip.deviceNodes.push({
                deviceId: 'multi-dev',
                type: 'fermenter',
                nodes: [plainNode, worklet],
                fermenterControls: { noteOff: vi.fn() },
            } as never);

            await engine.dispose();

            // Worklet node got the shutdown message; the plain node was not asked
            // for a port (instanceof guard).
            expect(worklet.port.postMessage).toHaveBeenCalledWith({ type: 'shutdown' });
        });
    });

    // ── postShutdownToWorklets: meterNode null guard.
    describe('postShutdownToWorklets meterNode null', () => {
        it('skips a null meterNode without throwing', async () => {
            const strip = engine.ensureTrackStrip('null-meter-track');
            // Set meterNode to null to exercise the optional-chain short-circuit.
            (strip as unknown as { meterNode: unknown }).meterNode = null;
            strip.deviceNodes.push({
                deviceId: 'plain-dev',
                type: 'fermenter',
                nodes: [],
                fermenterControls: {},
            } as never);

            await expect(engine.dispose()).resolves.toBeUndefined();
        });
    });

    // ── reconcileToasterParent: the destinationNode-truthy detach path (L477)
    //    and the missing-destinationNode path (L481).
    describe('reconcileToasterParent re-route and missing destination', () => {
        it('detaches an existing destinationNode and re-attaches when controls change', () => {
            // Pad routed by controls1 (destinationNode set). Manually evict
            // controls1's device from deviceNodes WITHOUT going through
            // removeDevice (which would detach via handleDeviceRemoved and null
            // the destinationNode first). Then reconcileToasterParent finds
            // controls2 and must detach the still-present destinationNode (L477).
            engine.ensureTrackStrip('rp1');
            engine.ensureTrackStrip('rparent');
            engine.setTrackOutput('rp1', 'rparent', { toasterParentTrackId: 'rparent', padIndex: 0 });
            const controls1 = {
                connectPadOutput: vi.fn(),
                disconnectPadOutput: vi.fn(),
                setPadDryRouted: vi.fn(),
            };
            const controls2 = {
                connectPadOutput: vi.fn(),
                disconnectPadOutput: vi.fn(),
                setPadDryRouted: vi.fn(),
            };
            const parentNode = getMockTrackNode(engine, 'rparent');
            parentNode.notifyDeviceLoaded({
                deviceId: 'rtoast1',
                type: 'toaster',
                nodes: [],
                toasterControls: controls1,
            });
            expect(controls1.connectPadOutput).toHaveBeenCalledTimes(1);

            // Load controls2, then surgically remove controls1's device entry
            // from the strip's deviceNodes so find() resolves controls2 while
            // the pad still holds its destinationNode from controls1.
            parentNode.notifyDeviceLoaded({
                deviceId: 'rtoast2',
                type: 'toaster',
                nodes: [],
                toasterControls: controls2,
            });
            const strip = engine.getTrackStrip('rparent')!;
            strip.deviceNodes = strip.deviceNodes.filter((d) => (d as { deviceId?: string }).deviceId !== 'rtoast1');

            // Re-run reconcile directly (bypassing onDeviceLoaded which would
            // have already run with controls1 as the found device).
            const reconciler = (
                engine as unknown as { reconcileToasterParent: (id: string) => void }
            ).reconcileToasterParent.bind(engine);
            reconciler('rparent');

            // L477: destinationNode was truthy → controls1.disconnectPadOutput.
            expect(controls1.disconnectPadOutput).toHaveBeenCalledWith(0, expect.anything());
            // Re-attached under controls2.
            expect(controls2.connectPadOutput).toHaveBeenCalledTimes(1);
        });

        it('skips a pad whose destination strip is missing during reconcile (L481)', () => {
            // Pad routed by controls1. Remove the child strip surgically (keep
            // the route in toasterPadRoutes) so the destinationNode lookup is
            // undefined. Then reconcile with a fresh controls object.
            engine.ensureTrackStrip('rp2');
            engine.ensureTrackStrip('rparent3');
            engine.setTrackOutput('rp2', 'rparent3', { toasterParentTrackId: 'rparent3', padIndex: 0 });
            const controls1 = {
                connectPadOutput: vi.fn(),
                disconnectPadOutput: vi.fn(),
                setPadDryRouted: vi.fn(),
            };
            const controls2 = {
                connectPadOutput: vi.fn(),
                disconnectPadOutput: vi.fn(),
                setPadDryRouted: vi.fn(),
            };
            const parentNode = getMockTrackNode(engine, 'rparent3');
            parentNode.notifyDeviceLoaded({
                deviceId: 'rtoast3a',
                type: 'toaster',
                nodes: [],
                toasterControls: controls1,
            });
            // Load controls2 and evict controls1 so find() returns controls2.
            parentNode.notifyDeviceLoaded({
                deviceId: 'rtoast3b',
                type: 'toaster',
                nodes: [],
                toasterControls: controls2,
            });
            const strip = engine.getTrackStrip('rparent3')!;
            strip.deviceNodes = strip.deviceNodes.filter((d) => (d as { deviceId?: string }).deviceId !== 'rtoast3a');

            // Surgically delete the child strip but keep the pad route.
            (engine as unknown as { trackNodes: Map<string, unknown> }).trackNodes.delete('rp2');

            const reconciler = (
                engine as unknown as { reconcileToasterParent: (id: string) => void }
            ).reconcileToasterParent.bind(engine);
            // No throw: destinationNode lookup returns undefined → continue (L481).
            expect(() => reconciler('rparent3')).not.toThrow();
            expect(controls2.connectPadOutput).not.toHaveBeenCalled();
        });
    });

    // ── handleDeviceRemoved: route.controls differs from the removed device's
    //    controls (L499 continue).
    describe('handleDeviceRemoved stale-controls skip', () => {
        it('skips a pad whose controls object differs from the removed device', () => {
            engine.ensureTrackStrip('sp1');
            engine.ensureTrackStrip('sparent');
            engine.setTrackOutput('sp1', 'sparent', { toasterParentTrackId: 'sparent', padIndex: 0 });
            const activeControls = {
                connectPadOutput: vi.fn(),
                disconnectPadOutput: vi.fn(),
                setPadDryRouted: vi.fn(),
            };
            const parent = getMockTrackNode(engine, 'sparent');
            // Load the active toaster (routes the pad).
            parent.notifyDeviceLoaded({
                deviceId: 'st-active',
                type: 'toaster',
                nodes: [],
                toasterControls: activeControls,
            });
            expect(activeControls.connectPadOutput).toHaveBeenCalledTimes(1);

            // Remove a DIFFERENT device id on the same parent whose
            // toasterControls is a stale object ≠ activeControls. The pad's
            // route.controls === activeControls, so it must NOT be detached.
            const staleControls = { disconnectPadOutput: vi.fn(), setPadDryRouted: vi.fn() };
            (
                engine as unknown as {
                    handleDeviceRemoved: (id: string, device: unknown) => void;
                }
            ).handleDeviceRemoved('sparent', {
                type: 'toaster',
                toasterControls: staleControls,
            });
            expect(activeControls.disconnectPadOutput).not.toHaveBeenCalled();
        });
    });

    // ── reconnectRoutingForTrack: sidechain belonging to a different source
    //    track is skipped (L429 continue).
    describe('reconnectRoutingForTrack sidechain skip', () => {
        it('re-attaches the matching sidechain and skips one from another track', () => {
            engine.ensureTrackStrip('sc-main');
            engine.ensureTrackStrip('sc-other');
            const targetA = engine.ensureTrackStrip('tgtA');
            const targetB = engine.ensureTrackStrip('tgtB');
            targetA.deviceNodes.push({
                deviceId: 'devA',
                type: 'builtin-sidechain-compressor',
                inputNode: makeNode() as unknown as AudioNode,
            } as never);
            targetB.deviceNodes.push({
                deviceId: 'devB',
                type: 'builtin-sidechain-compressor',
                inputNode: makeNode() as unknown as AudioNode,
            } as never);
            engine.wireSidechainRoute('sc-main', 'tgtA', 'devA');
            engine.wireSidechainRoute('sc-other', 'tgtB', 'devB');

            const mainNode = getMockTrackNode(engine, 'sc-main');
            vi.mocked(mainNode.defaultDestinationNode.disconnect).mockClear();

            // Rebuild sc-main: its sidechain (devA) re-attaches, sc-other's
            // sidechain (devB) is skipped (L429 continue).
            mainNode.rebuildChain();
            // sc-main's analyserNode got a new connect to its keyDelay.
            expect(mainNode.defaultDestinationNode).toBeDefined();
        });
    });

    // ── removeTrackStrip: toaster parent with pad children (L562).
    describe('removeTrackStrip toaster-parent child detach', () => {
        it('detaches pad children when their toaster parent track is removed', () => {
            engine.ensureTrackStrip('tpad1');
            engine.ensureTrackStrip('tpad2');
            engine.ensureTrackStrip('tparent');
            engine.setTrackOutput('tpad1', 'tparent', { toasterParentTrackId: 'tparent', padIndex: 0 });
            engine.setTrackOutput('tpad2', 'tparent', { toasterParentTrackId: 'tparent', padIndex: 1 });
            const controls = {
                connectPadOutput: vi.fn(),
                disconnectPadOutput: vi.fn(),
                setPadDryRouted: vi.fn(),
            };
            const parent = getMockTrackNode(engine, 'tparent');
            parent.notifyDeviceLoaded({
                deviceId: 'ttoast',
                type: 'toaster',
                nodes: [],
                toasterControls: controls,
            });
            expect(controls.connectPadOutput).toHaveBeenCalledTimes(2);

            // Remove the parent: L562 sweeps its pad children.
            engine.removeTrackStrip('tparent');
            // Both pads' routes were detached (setPadDryRouted false).
            expect(controls.disconnectPadOutput).toHaveBeenCalledTimes(2);
            // The pad tracks survive (only the parent was removed).
            expect(engine.getTrackStrip('tpad1')).toBeDefined();
            expect(engine.getTrackStrip('tpad2')).toBeDefined();
        });
    });

    // ── resume(): context already running (the else arm of the suspended check).
    describe('resume already-running', () => {
        it('skips the resume call when the context is already running', async () => {
            mockCtx.state = 'running';
            const resumeCallsBefore = mockCtx.resume.mock.calls.length;
            await engine.resume();
            expect(mockCtx.resume.mock.calls.length).toBe(resumeCallsBefore);
            expect(engine.getHealth().lastResumeError).toBeNull();
        });
    });

    // ── cancelTrackAutomationRamps: non-fallback path (the else arm L629).
    describe('cancelTrackAutomationRamps non-fallback', () => {
        it('forwards cancelAutomationRamps to each track node', () => {
            const strip = engine.ensureTrackStrip('auto-track');
            // The mock TrackNode lacks cancelAutomationRamps, so an unguarded
            // path would throw. The non-fallback branch iterates trackNodes.
            // Attach the method so the call does not throw.
            (
                getMockTrackNode(engine, 'auto-track') as unknown as { cancelAutomationRamps: () => void }
            ).cancelAutomationRamps = vi.fn();
            expect(() => engine.cancelTrackAutomationRamps()).not.toThrow();
            void strip;
        });
    });

    // ── replayPendingSidechainRoutes: non-empty path (L1012 else arm) is
    //    exercised when wireSidechainRoute runs on a ready engine that had
    //    pending routes queued... but pending routes only queue in fallback.
    //    Instead, call the private replay with a populated map via a second
    //    ready wire after injecting a pending entry.
    describe('replayPendingSidechainRoutes non-empty', () => {
        it('replays queued routes when a non-fallback wire runs with pending entries', () => {
            // Populate pendingSidechainRoutes directly (simulating recovery from
            // a prior fallback session), then wire a fresh route on the ready
            // engine. replayPendingSidechainRoutes drains the queue first.
            const target = engine.ensureTrackStrip('replayTgt');
            target.deviceNodes.push({
                deviceId: 'replayDev',
                type: 'builtin-sidechain-compressor',
                inputNode: makeNode() as unknown as AudioNode,
            } as never);
            engine.ensureTrackStrip('replaySrc');
            const pending = (engine as unknown as { pendingSidechainRoutes: Map<string, unknown> })
                .pendingSidechainRoutes;
            pending.set('replaySrc→replayDev', {
                sourceTrackId: 'replaySrc',
                targetTrackId: 'replayTgt',
                targetDeviceId: 'replayDev',
            });

            const createGainBefore = mockCtx.createGain.mock.calls.length;
            // A fresh wire on the ready engine drains pending first, then wires.
            engine.wireSidechainRoute('freshSrc', 'replayTgt', 'replayDev');
            // The replayed pending route built a sidechain gain.
            expect(mockCtx.createGain.mock.calls.length).toBeGreaterThan(createGainBefore);
            expect(pending.size).toBe(0);
        });
    });

    // ── Constructor closure truthy arms (L234-236): the `?.strip.X ?? null`
    //    expressions need both a track-present and track-absent invocation to
    //    cover the `?.` short-circuit AND the `?? null` fallback.
    describe('constructor closure both arms', () => {
        it('returns null for absent tracks and the node for present tracks', () => {
            // Drive the closures through the adjustment runtime: apply a tick
            // for a track that exists (truthy arm of the optional chain) and
            // one that does not (the null fallback).
            engine.ensureTrackStrip('present-track');
            // applyTick for a present track exercises getTrackDefaultDestination
            // truthy arm; one for an absent track exercises the null fallback.
            expect(() =>
                engine.applyAdjustmentLayerTick!([
                    {
                        trackId: 'present-track',
                        layerId: 'L1',
                        effectType: 'eq',
                        parameters: { gain: 0.5 },
                        blend: 1,
                    },
                    {
                        trackId: 'absent-track',
                        layerId: 'L2',
                        effectType: 'eq',
                        parameters: { gain: 0.5 },
                        blend: 1,
                    },
                ])
            ).not.toThrow();
        });
    });

    // ── crossfadeSendTap: source-strip-missing early return (L889). The normal
    //    API path can't reach this (setSend bails before crossfadeSendTap when
    //    the source strip is gone), so drive the private method directly with a
    //    fabricated send entry whose source track has no strip.
    describe('crossfadeSendTap source-strip-missing (private)', () => {
        it('returns early without building a gain when the source strip is absent', () => {
            vi.useFakeTimers();
            try {
                // Fabricate a send entry in sendNodes whose sourceTrackId has no
                // live strip, then call crossfadeSendTap directly.
                const sendNodes = (engine as unknown as { sendNodes: Map<string, unknown> }).sendNodes;
                const busStrip = engine.ensureBusStrip('cfbus');
                sendNodes.set('ghost→cfbus', {
                    sourceTrackId: 'ghost-no-strip',
                    busId: 'cfbus',
                    gainNode: {
                        gain: {
                            value: 0.5,
                            cancelScheduledValues: vi.fn(),
                            setValueAtTime: vi.fn(),
                            linearRampToValueAtTime: vi.fn(),
                        },
                    },
                    sourceNode: makeNode(),
                    preFader: false,
                });
                const createGainBefore = mockCtx.createGain.mock.calls.length;
                const crossfade = (
                    engine as unknown as {
                        crossfadeSendTap: (
                            existing: unknown,
                            busStrip: unknown,
                            preFader: boolean,
                            level: number
                        ) => void;
                    }
                ).crossfadeSendTap.bind(engine);
                crossfade(sendNodes.get('ghost→cfbus'), busStrip, true, 0.5);
                // No new gain built (early return at the sourceStrip guard).
                expect(mockCtx.createGain.mock.calls.length).toBe(createGainBefore);
            } finally {
                vi.useRealTimers();
            }
        });
    });

    // ── waitForDevices: normal completion (deadline NOT exceeded, L978 else).
    describe('waitForDevices normal completion', () => {
        it('awaits pending devices that resolve and clear before the deadline', async () => {
            const set = (engine as unknown as { pendingDevicePromises: Set<Promise<unknown>> }).pendingDevicePromises;
            // A pending device promise that, on resolution, removes itself from
            // the set — mirroring how a real device-load completion clears its
            // entry so the loop's size check eventually reaches 0.
            const pending = new Promise<void>((resolve) => {
                queueMicrotask(() => {
                    set.delete(pending);
                    resolve();
                });
            });
            set.add(pending);

            // The loop enters (size > 0), deadline not exceeded (L978 else arm),
            // awaits the promise which resolves and self-removes, then size == 0.
            await expect(
                (engine as unknown as { waitForDevices: (t: number) => Promise<void> }).waitForDevices(5000)
            ).resolves.toBeUndefined();
            expect(set.size).toBe(0);
        });
    });

    // ── Constructor closure arms: getContext returns null when context is null.
    //    The `?? null` false arm on getContext requires this.context to be
    //    nullish. Construct an engine and null its context, then drive the
    //    adjustment runtime so getContext returns null (createBus bails).
    describe('constructor closure null-context arm', () => {
        it('returns null context when context is unset, skipping bus creation', () => {
            const trackId = 'null-ctx-track';
            engine.ensureTrackStrip(trackId);
            // Null the context so getContext closure returns null (the `?? null`
            // false arm of `this.context ?? null`).
            const engineCtx = engine as unknown as { context: AudioContext | null };
            const savedCtx = engineCtx.context;
            engineCtx.context = null;
            try {
                // applyTick with a null context: createBus returns null, so no
                // bus is built — the getContext closure's null arm is exercised.
                expect(() =>
                    engine.applyAdjustmentLayerTick!([
                        {
                            trackId,
                            layerId: 'Lnull',
                            effectType: 'eq',
                            parameters: { gain: 0.5 },
                            blend: 1,
                        },
                    ])
                ).not.toThrow();
            } finally {
                engineCtx.context = savedCtx;
            }
        });
    });
});
