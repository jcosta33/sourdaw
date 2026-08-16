import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createMockAudioContext, createMockAudioNode } from '#/helpers/__tests__/audioContext.mock';

import { type BuiltinDeviceNode, type SendNode } from '../../models/AudioEngineState';
import { createDeviceReadinessDiagnostics, type DeviceContentLoadOutcome } from '../deviceReadinessDiagnostics';
import { RuntimeGraphMutationFailure, TrackNode, type TrackNodeDeps } from '../TrackNode';

const mocks = vi.hoisted(() => ({
    hasSharedArrayBuffer: vi.fn(() => true),
    findWasmDescriptor: vi.fn(),
    loggerDebug: vi.fn(),
}));

vi.mock('#/utils/capabilities', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/utils/capabilities')>()),
    hasSharedArrayBuffer: mocks.hasSharedArrayBuffer,
}));

vi.mock('../wasmDeviceRegistry', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../wasmDeviceRegistry')>()),
    findWasmDescriptor: mocks.findWasmDescriptor,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { debug: mocks.loggerDebug, warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

type MockContext = ReturnType<typeof createMockAudioContext>;
type WorkletParamStub = { setTargetAtTime: ReturnType<typeof vi.fn> };

const workletInstances: Array<{
    port: { postMessage: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
    parameters: Map<string, WorkletParamStub>;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
}> = [];

class FakeAudioWorkletNode {
    port = { postMessage: vi.fn(), close: vi.fn(), onmessage: null };
    parameters = new Map<string, WorkletParamStub>([
        ['threshold', { setTargetAtTime: vi.fn() }],
        ['attack', { setTargetAtTime: vi.fn() }],
        ['release', { setTargetAtTime: vi.fn() }],
    ]);
    connect = vi.fn();
    disconnect = vi.fn();

    constructor() {
        workletInstances.push(this);
    }
}

function makeDeps(ctx: MockContext, overrides?: Partial<TrackNodeDeps>): TrackNodeDeps {
    return {
        context: ctx as unknown as AudioContext,
        masterGainNode: ctx.createGain() as unknown as GainNode,
        getBusGainNode: vi.fn(() => undefined),
        getTrackGainNode: vi.fn(() => undefined),
        getSendsForTrack: vi.fn(() => []),
        pendingDevicePromises: new Set(),
        readinessDiagnostics: createDeviceReadinessDiagnostics(),
        ...overrides,
    };
}

function pushControllerDevice(
    track: TrackNode,
    overrides?: Partial<BuiltinDeviceNode>
): { node: ReturnType<typeof createMockAudioNode<'gain'>>; controller: NonNullable<BuiltinDeviceNode['controller']> } {
    const node = createMockAudioNode('gain');
    const controller = {
        setParam: vi.fn(),
        setPatch: vi.fn(),
        scheduleParam: vi.fn(),
        keyOn: vi.fn(),
        keyOff: vi.fn(),
        setBypass: vi.fn(),
        destroy: vi.fn(),
    };
    track.strip.deviceNodes.push({
        deviceId: 'dev-1',
        type: 'test-device',
        nodes: [node],
        inputNode: node,
        outputNode: node,
        controller,
        ...overrides,
    });
    return { node, controller };
}

function installDeferredWasmDevice({
    deviceId = 'wasm-1',
    controller,
    beforeLoaded,
    requiresContent = true,
}: {
    deviceId?: string;
    controller?: BuiltinDeviceNode['controller'];
    beforeLoaded?: (finalDn: BuiltinDeviceNode) => void;
    requiresContent?: boolean;
} = {}) {
    type DeferredGeneration = {
        load: PromiseWithResolvers<void>;
        onLoaded: (finalDn: BuiltinDeviceNode) => void;
        onContentLoadSettled?: (outcome: DeviceContentLoadOutcome) => void;
        onRuntimeFailure?: (failedDn: BuiltinDeviceNode, replacementDn: BuiltinDeviceNode) => boolean;
        onRuntimeRecovery?: (replacementDn: BuiltinDeviceNode) => void;
        placeholder: BuiltinDeviceNode;
        signal?: AbortSignal;
    };
    const generations: DeferredGeneration[] = [];
    const getGeneration = (index = generations.length - 1): DeferredGeneration => {
        const generation = generations[index];
        if (!generation) {
            throw new Error(`expected deferred device generation ${index}`);
        }
        return generation;
    };
    mocks.findWasmDescriptor.mockReturnValue({
        requiresContent,
        matches: () => true,
        create: (deps: {
            onLoaded: (finalDn: BuiltinDeviceNode) => void;
            onContentLoadSettled?: (outcome: DeviceContentLoadOutcome) => void;
            onRuntimeFailure?: (failedDn: BuiltinDeviceNode, replacementDn: BuiltinDeviceNode) => boolean;
            onRuntimeRecovery?: (replacementDn: BuiltinDeviceNode) => void;
            signal?: AbortSignal;
        }) => {
            const placeholderNode = createMockAudioNode('gain');
            const placeholder: BuiltinDeviceNode = {
                deviceId,
                type: 'levain',
                nodes: [placeholderNode],
                inputNode: placeholderNode,
                outputNode: placeholderNode,
                controller,
            };
            const load = Promise.withResolvers<void>();
            generations.push({
                load,
                onLoaded: deps.onLoaded,
                onContentLoadSettled: deps.onContentLoadSettled,
                onRuntimeFailure: deps.onRuntimeFailure,
                onRuntimeRecovery: deps.onRuntimeRecovery,
                placeholder,
                signal: deps.signal,
            });
            return { placeholder, loadPromise: load.promise };
        },
    });
    return {
        get generationCount(): number {
            return generations.length;
        },
        get placeholder(): BuiltinDeviceNode {
            return getGeneration().placeholder;
        },
        get signal(): AbortSignal | undefined {
            return getGeneration().signal;
        },
        resolve(finalDn: BuiltinDeviceNode, generationIndex?: number): void {
            const generation = getGeneration(generationIndex);
            beforeLoaded?.(finalDn);
            generation.onLoaded(finalDn);
        },
        fail(finalDn: BuiltinDeviceNode, generationIndex?: number): void {
            const generation = getGeneration(generationIndex);
            if (!generation.onRuntimeFailure) {
                throw new Error('expected the deferred descriptor to capture onRuntimeFailure');
            }
            const replaced = generation.onRuntimeFailure(finalDn, generation.placeholder);
            if (replaced) {
                generation.onRuntimeRecovery?.(generation.placeholder);
            }
        },
        settle(generationIndex?: number): void {
            getGeneration(generationIndex).load.resolve();
        },
        settleContent(outcome: DeviceContentLoadOutcome, generationIndex?: number): void {
            const generation = getGeneration(generationIndex);
            if (!generation.onContentLoadSettled) {
                throw new Error('expected the deferred descriptor to capture onContentLoadSettled');
            }
            generation.onContentLoadSettled(outcome);
        },
    };
}

function createLoadedDevice(deviceId = 'wasm-1') {
    const node = createMockAudioNode('gain');
    const controller = { setParam: vi.fn(), setBypass: vi.fn(), destroy: vi.fn() };
    const dispose = vi.fn();
    const device: BuiltinDeviceNode = {
        deviceId,
        type: 'levain',
        nodes: [node],
        inputNode: node,
        outputNode: node,
        controller,
        dispose,
    };
    return { device, node, controller, dispose };
}

describe('TrackNode — metering, devices, sends, and teardown', () => {
    let ctx: MockContext;

    beforeEach(() => {
        vi.clearAllMocks();
        workletInstances.length = 0;
        mocks.hasSharedArrayBuffer.mockReturnValue(true);
        mocks.findWasmDescriptor.mockReturnValue(undefined);
        vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
        vi.stubGlobal(
            'SharedArrayBuffer',
            class extends ArrayBuffer {
                constructor(length: number) {
                    super(length);
                }
            }
        );
        ctx = createMockAudioContext();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('getPeakLevel', () => {
        it('reads and resets the SAB meter slot', () => {
            const track = new TrackNode('t1', makeDeps(ctx));
            expect(track.strip.meterNode).not.toBeNull();

            track.strip.meterBuffer[0] = 0.5;

            expect(track.getPeakLevel()).toBe(0.5);
            // Read-and-reset: the slot is consumed.
            expect(track.strip.meterBuffer[0]).toBe(0);
            expect(track.getPeakLevel()).toBe(0);
        });

        it('falls back to analyser time-domain peaks when SharedArrayBuffer is unavailable', () => {
            mocks.hasSharedArrayBuffer.mockReturnValue(false);
            const track = new TrackNode('t1', makeDeps(ctx));

            expect(track.strip.meterNode).toBeNull();
            const analyser = track.strip.analyserNode as unknown as ReturnType<typeof createMockAudioNode<'analyser'>>;
            // Without the meter worklet the pan node feeds the analyser directly.
            expect(
                (track.strip.panNode as unknown as ReturnType<typeof createMockAudioNode<'stereo-panner'>>).connect
            ).toHaveBeenCalledWith(analyser);
            analyser.getFloatTimeDomainData.mockImplementation((buffer: Float32Array) => {
                buffer.fill(0);
                buffer[0] = 0.3;
                buffer[5] = -0.7;
            });

            expect(track.getPeakLevel()).toBeCloseTo(0.7, 6);
        });
    });

    describe('device parameter routing', () => {
        it('updatePatch forwards to controllers that support patches and ignores those that do not', () => {
            const track = new TrackNode('t1', makeDeps(ctx));
            const { controller } = pushControllerDevice(track);

            track.updatePatch('dev-1', { osc: 'saw' });
            expect(controller.setPatch).toHaveBeenCalledWith({ osc: 'saw' });

            track.strip.deviceNodes[0]!.controller = { setParam: vi.fn() };
            expect(() => track.updatePatch('dev-1', { osc: 'square' })).not.toThrow();
            expect(() => track.updatePatch('ghost', {})).not.toThrow();
        });

        it('scheduleParam prefers a native scheduleParam and falls back to a sample-frame hint', () => {
            const track = new TrackNode('t1', makeDeps(ctx));
            const { controller } = pushControllerDevice(track);

            track.scheduleParam('dev-1', 'cutoff', 0.4, 1.5);
            expect(controller.scheduleParam).toHaveBeenCalledWith('cutoff', 0.4, 1.5);
            expect(controller.setParam).not.toHaveBeenCalled();

            // MessagePort devices schedule via setParam's sample-frame third arg.
            const setParam = vi.fn();
            track.strip.deviceNodes[0]!.controller = { setParam };
            track.scheduleParam('dev-1', 'cutoff', 0.4, 1.5);
            // 1.5s at the 48 kHz mock context = frame 72000.
            expect(setParam).toHaveBeenCalledWith('cutoff', 0.4, 72_000);
        });

        it('routes key events to the device controller and tolerates devices without key handlers', () => {
            const track = new TrackNode('t1', makeDeps(ctx));
            const { controller } = pushControllerDevice(track);

            track.scheduleDeviceKeyOn('dev-1', 64, 100, 0.25);
            expect(controller.keyOn).toHaveBeenCalledWith(0, 64, 100, 0.25);

            track.scheduleDeviceKeyOff('dev-1', 64, 0, 0.75);
            expect(controller.keyOff).toHaveBeenCalledWith(0, 64, 0, 0.75);

            track.strip.deviceNodes[0]!.controller = { setParam: vi.fn() };
            expect(() => track.scheduleDeviceKeyOn('dev-1', 64, 100)).not.toThrow();
            expect(() => track.scheduleDeviceKeyOff('ghost', 64, 0)).not.toThrow();
        });
    });

    describe('removeDevice', () => {
        it('destroys the controller, disconnects its nodes, and rewires the chain', () => {
            const onDeviceRemoved = vi.fn();
            const track = new TrackNode('t1', makeDeps(ctx, { onDeviceRemoved }));
            const { node, controller } = pushControllerDevice(track);
            track.rebuildChain();
            const gainNode = track.strip.gainNode as unknown as ReturnType<typeof createMockAudioNode<'gain'>>;
            gainNode.connect.mockClear();

            track.removeDevice('dev-1');

            expect(controller.destroy).toHaveBeenCalledTimes(1);
            expect(node.disconnect).toHaveBeenCalled();
            expect(track.strip.deviceNodes).toHaveLength(0);
            expect(onDeviceRemoved).toHaveBeenCalledWith('t1', expect.objectContaining({ deviceId: 'dev-1' }));
            // With no devices the dry path reconnects gain → preFaderTap.
            expect(gainNode.connect).toHaveBeenCalledWith(track.strip.preFaderTap);
        });

        it('reports needs-reconcile truth when removal changed the live strip before rebuild failure', () => {
            const onDeviceRemoved = vi.fn();
            const track = new TrackNode('t1', makeDeps(ctx, { onDeviceRemoved }));
            const { node, controller } = pushControllerDevice(track);
            vi.spyOn(track, 'rebuildChain').mockImplementationOnce(() => {
                throw new Error('removal graph rebuild failed');
            });

            let failure: unknown;
            try {
                track.removeDevice('dev-1');
            } catch (error) {
                failure = error;
            }

            expect(failure).toBeInstanceOf(RuntimeGraphMutationFailure);
            if (!(failure instanceof RuntimeGraphMutationFailure)) {
                throw new Error('Expected a runtime graph mutation failure');
            }
            expect(failure.mutation).toMatchObject({
                application: 'needs-reconcile',
                reason: expect.stringContaining('removed'),
            });
            expect(track.strip.deviceNodes).toHaveLength(0);
            expect(onDeviceRemoved).toHaveBeenCalledWith('t1', expect.objectContaining({ deviceId: 'dev-1' }));
            expect(controller.destroy).toHaveBeenCalledTimes(1);
            expect(node.disconnect).toHaveBeenCalled();
        });

        it('uses dispose for factory devices without a controller and ignores unknown ids', () => {
            const track = new TrackNode('t1', makeDeps(ctx));
            const node = createMockAudioNode('gain');
            const dispose = vi.fn();
            track.strip.deviceNodes.push({
                deviceId: 'dev-raw',
                type: 'builtin-gain',
                nodes: [node],
                inputNode: node,
                outputNode: node,
                dispose,
            });

            track.removeDevice('dev-raw');
            expect(dispose).toHaveBeenCalledTimes(1);
            expect(track.strip.deviceNodes).toHaveLength(0);

            expect(() => track.removeDevice('ghost')).not.toThrow();
        });

        it.each(['builtin-autopan', 'builtin-chorus', 'builtin-flanger', 'builtin-phaser', 'builtin-tremolo'])(
            'stops sources and disconnects each %s graph node exactly once',
            (deviceType) => {
                const track = new TrackNode('t1', makeDeps(ctx));
                track.addDevice('modulation-1', deviceType);
                const device = track.strip.deviceNodes[0];
                if (!device) {
                    throw new Error(`Expected ${deviceType} to be published`);
                }
                const oscillators = device.nodes.filter((node) => typeof Reflect.get(node, 'stop') === 'function');
                for (const node of device.nodes) {
                    vi.mocked(node.disconnect).mockClear();
                }

                track.removeDevice('modulation-1');

                expect(oscillators.length).toBeGreaterThan(0);
                for (const oscillator of oscillators) {
                    expect(Reflect.get(oscillator, 'stop')).toHaveBeenCalledTimes(1);
                }
                for (const node of device.nodes) {
                    expect(node.disconnect).toHaveBeenCalledTimes(1);
                }
            }
        );
    });

    describe('MIDI FX bookkeeping', () => {
        it('adds, updates, bypasses, and removes MIDI FX records on the strip', () => {
            const track = new TrackNode('t1', makeDeps(ctx));

            track.addMidiFx('fx-1', 'arp');
            track.addMidiFx('fx-2', 'velocity');
            expect(track.strip.midiFxNodes).toEqual([
                { id: 'fx-1', type: 'arp', bypassed: false, parameterValues: {} },
                { id: 'fx-2', type: 'velocity', bypassed: false, parameterValues: {} },
            ]);

            track.updateMidiFxParam('fx-1', 'rate', 8);
            expect(track.strip.midiFxNodes[0]!.parameterValues).toEqual({ rate: 8 });

            track.updateMidiFxBypass('fx-2', true);
            expect(track.strip.midiFxNodes[1]!.bypassed).toBe(true);

            // Unknown ids are ignored without throwing.
            expect(() => track.updateMidiFxParam('ghost', 'rate', 1)).not.toThrow();
            expect(() => track.updateMidiFxBypass('ghost', true)).not.toThrow();

            track.removeMidiFx('fx-1');
            expect(track.strip.midiFxNodes.map((fx) => fx.id)).toEqual(['fx-2']);
        });
    });

    describe('send reconnection', () => {
        it('delegates live route reconciliation to the graph owner after a rebuild', () => {
            const reconnectRoutingForTrack = vi.fn();
            const track = new TrackNode('t1', makeDeps(ctx, { reconnectRoutingForTrack }));

            track.rebuildChain();

            expect(reconnectRoutingForTrack).toHaveBeenCalledWith('t1');
        });

        it('taps pre-fader sends off the preFaderTap and post-fader sends off the analyser', () => {
            const busGain = createMockAudioNode('gain');
            const preFaderSend = {
                sourceTrackId: 't1',
                busId: 'bus-1',
                preFader: true,
                gainNode: createMockAudioNode('gain') as unknown as GainNode,
                sourceNode: createMockAudioNode('gain'),
            } satisfies SendNode;
            const postFaderSend = {
                sourceTrackId: 't1',
                busId: 'bus-1',
                preFader: false,
                gainNode: createMockAudioNode('gain') as unknown as GainNode,
                sourceNode: createMockAudioNode('gain'),
            } satisfies SendNode;
            const orphanSend = {
                sourceTrackId: 't1',
                busId: 'missing-bus',
                preFader: false,
                gainNode: createMockAudioNode('gain') as unknown as GainNode,
                sourceNode: createMockAudioNode('gain'),
            } satisfies SendNode;
            const deps = makeDeps(ctx, {
                getSendsForTrack: vi.fn(() => [preFaderSend, postFaderSend, orphanSend]),
                getBusGainNode: vi.fn((id: string) => (id === 'bus-1' ? (busGain as unknown as GainNode) : undefined)),
            });
            const track = new TrackNode('t1', deps);

            track.rebuildChain();

            const preFaderTap = track.strip.preFaderTap as unknown as ReturnType<typeof createMockAudioNode<'gain'>>;
            const analyser = track.strip.analyserNode as unknown as ReturnType<typeof createMockAudioNode<'analyser'>>;
            expect(preFaderTap.connect).toHaveBeenCalledWith(preFaderSend.gainNode);
            expect(analyser.connect).toHaveBeenCalledWith(postFaderSend.gainNode);

            const preFaderSendGain = preFaderSend.gainNode as unknown as ReturnType<typeof createMockAudioNode<'gain'>>;
            const orphanSendGain = orphanSend.gainNode as unknown as ReturnType<typeof createMockAudioNode<'gain'>>;
            expect(preFaderSendGain.connect).toHaveBeenCalledWith(busGain);
            // A send whose bus is gone is re-tapped but not connected anywhere.
            expect(orphanSendGain.connect).not.toHaveBeenCalled();
        });
    });

    describe('output routing', () => {
        it('routes the analyser into the adjustment bus when one is active for the track', () => {
            const adjustmentBus = createMockAudioNode('gain');
            const deps = makeDeps(ctx, {
                getAdjustmentBusForTrack: vi.fn(() => adjustmentBus as unknown as AudioNode),
            });
            const track = new TrackNode('t1', deps);

            const analyser = track.strip.analyserNode as unknown as ReturnType<typeof createMockAudioNode<'analyser'>>;
            expect(analyser.connect).toHaveBeenCalledWith(adjustmentBus);
            expect(analyser.connect).not.toHaveBeenCalledWith(deps.masterGainNode);
        });

        it('keeps an active adjustment bus as the live edge when its declared output changes', () => {
            const adjustmentBus = createMockAudioNode('gain');
            const targetBus = createMockAudioNode('gain');
            const deps = makeDeps(ctx, {
                getAdjustmentBusForTrack: vi.fn(() => adjustmentBus as unknown as AudioNode),
                getBusGainNode: vi.fn(() => targetBus as unknown as GainNode),
            });
            const track = new TrackNode('t1', deps);
            const analyser = track.strip.analyserNode as unknown as ReturnType<typeof createMockAudioNode<'analyser'>>;
            vi.mocked(analyser.connect).mockClear();
            vi.mocked(analyser.disconnect).mockClear();

            track.setOutput('target-bus');

            expect(track.strip.outputId).toBe('target-bus');
            expect(track.getDefaultDestination()).toBe(targetBus);
            expect(analyser.disconnect).not.toHaveBeenCalled();
            expect(analyser.connect).not.toHaveBeenCalled();
        });

        it('falls back from bus to track target to master when resolving the default destination', () => {
            const trackTarget = createMockAudioNode('gain');
            const deps = makeDeps(ctx, {
                getBusGainNode: vi.fn(() => undefined),
                getTrackGainNode: vi.fn((id: string) =>
                    id === 't-target' ? (trackTarget as unknown as GainNode) : undefined
                ),
            });
            const track = new TrackNode('t1', deps);

            track.setOutput('t-target');
            expect(track.getDefaultDestination()).toBe(trackTarget);

            track.setOutput('nowhere');
            expect(track.getDefaultDestination()).toBe(deps.masterGainNode);

            track.setOutput('hw_out');
            expect(track.getDefaultDestination()).toBe(deps.masterGainNode);
        });
    });

    describe('sidechain compressor device', () => {
        it('creates a two-input worklet whose params are scheduled with ms→s conversion for attack/release', () => {
            const track = new TrackNode('t1', makeDeps(ctx));
            const meterWorkletCount = workletInstances.length;

            track.addDevice('sc-1', 'builtin-sidechain-compressor');

            expect(workletInstances).toHaveLength(meterWorkletCount + 1);
            const device = track.strip.deviceNodes.find((candidate) => candidate.deviceId === 'sc-1');
            if (!device?.controller) {
                throw new Error('expected the sidechain compressor device with controller');
            }

            const workletNode = workletInstances[workletInstances.length - 1]!;
            device.controller.setParam('sc-comp-attack', 30);
            expect(workletNode.parameters.get('attack')!.setTargetAtTime).toHaveBeenCalledWith(
                0.03,
                ctx.currentTime,
                0.01
            );

            device.controller.setParam('sc-comp-release', 250);
            expect(workletNode.parameters.get('release')!.setTargetAtTime).toHaveBeenCalledWith(
                0.25,
                ctx.currentTime,
                0.01
            );

            device.controller.setParam('sc-comp-threshold', -20);
            expect(workletNode.parameters.get('threshold')!.setTargetAtTime).toHaveBeenCalledWith(
                -20,
                ctx.currentTime,
                0.01
            );

            // Unknown params are dropped without touching any AudioParam.
            expect(() => device.controller!.setParam('sc-comp-ghost', 1)).not.toThrow();

            device.controller.setBypass?.(true);
            expect(device.bypassed).toBe(true);
        });
    });

    describe('addDevice guards and async wasm loads', () => {
        it('records synchronous node, graph, and playable readiness', () => {
            const readinessDiagnostics = createDeviceReadinessDiagnostics();
            const track = new TrackNode('t1', makeDeps(ctx, { readinessDiagnostics }));

            track.addDevice('gain-1', 'builtin-gain');

            expect(readinessDiagnostics.snapshot()).toMatchObject({
                counts: { requested: 1, nodeReady: 1, graphReady: 1, playableReady: 1 },
                devices: [{ deviceId: 'gain-1', deviceType: 'builtin-gain', status: 'ready' }],
            });
        });

        it('rolls back a synchronous device whose graph cannot be connected so the id remains retryable', () => {
            const readinessDiagnostics = createDeviceReadinessDiagnostics();
            const track = new TrackNode('t1', makeDeps(ctx, { readinessDiagnostics }));
            vi.spyOn(track, 'rebuildChain').mockImplementationOnce(() => {
                throw new Error('graph connection failed');
            });

            expect(() => track.addDevice('gain-1', 'builtin-gain')).toThrow('graph connection failed');

            expect(track.strip.deviceNodes).toHaveLength(0);
            expect(track.getDeviceLoadState('gain-1')).toBe('failed');

            expect(() => track.addDevice('gain-1', 'builtin-gain')).not.toThrow();
            expect(track.strip.deviceNodes.map((device) => device.deviceId)).toEqual(['gain-1']);
            expect(track.getDeviceLoadState('gain-1')).toBe('ready');
        });

        it('preserves both errors and reports needs-reconcile when synchronous add rollback cannot restore the graph', () => {
            const readinessDiagnostics = createDeviceReadinessDiagnostics();
            const track = new TrackNode('t1', makeDeps(ctx, { readinessDiagnostics }));
            const rebuildError = new Error('device graph rebuild failed');
            const rollbackError = new Error('device graph rollback failed');
            vi.spyOn(track, 'rebuildChain')
                .mockImplementationOnce(() => {
                    throw rebuildError;
                })
                .mockImplementationOnce(() => {
                    throw rollbackError;
                });

            let failure: unknown;
            try {
                track.addDevice('gain-1', 'builtin-gain');
            } catch (error) {
                failure = error;
            }

            expect(failure).toBeInstanceOf(RuntimeGraphMutationFailure);
            if (!(failure instanceof RuntimeGraphMutationFailure)) {
                throw new Error('Expected a runtime graph mutation failure');
            }
            expect(failure.cause).toBe(rebuildError);
            expect(failure.rollbackError).toBe(rollbackError);
            expect(failure.mutation).toMatchObject({
                application: 'needs-reconcile',
                reason: expect.stringContaining('added'),
            });
            expect(track.strip.deviceNodes).toHaveLength(0);
            expect(track.getDeviceLoadState('gain-1')).toBe('failed');
        });

        it('records async processor and graph readiness before content readiness', async () => {
            const deferred = installDeferredWasmDevice({ requiresContent: true });
            const readinessDiagnostics = createDeviceReadinessDiagnostics();
            const track = new TrackNode('t1', makeDeps(ctx, { readinessDiagnostics }));

            track.addDevice('wasm-1', 'levain');
            expect(readinessDiagnostics.snapshot().devices[0]?.status).toBe('node-pending');
            expect(track.getDeviceLoadState('wasm-1')).toBe('pending');

            deferred.resolve(createLoadedDevice().device);
            expect(readinessDiagnostics.snapshot().devices[0]?.status).toBe('graph-pending');
            expect(track.getDeviceLoadState('wasm-1')).toBe('pending');
            await Promise.resolve();
            expect(readinessDiagnostics.snapshot().devices[0]?.status).toBe('content-pending');
            expect(track.getDeviceLoadState('wasm-1')).toBe('pending');

            deferred.settleContent('ready');
            expect(track.getDeviceLoadState('wasm-1')).toBe('ready');
            expect(readinessDiagnostics.snapshot()).toMatchObject({
                counts: { requested: 1, nodeReady: 1, graphReady: 1, contentReady: 1, playableReady: 1 },
                devices: [{ deviceId: 'wasm-1', deviceType: 'levain', status: 'ready' }],
            });
        });

        it('makes a content-free async device playable after its graph rebuild', async () => {
            const deferred = installDeferredWasmDevice({ requiresContent: false });
            const readinessDiagnostics = createDeviceReadinessDiagnostics();
            const track = new TrackNode('t1', makeDeps(ctx, { readinessDiagnostics }));

            track.addDevice('wasm-1', 'fermenter');
            deferred.resolve(createLoadedDevice().device);
            await Promise.resolve();

            expect(readinessDiagnostics.snapshot()).toMatchObject({
                counts: { requested: 1, nodeReady: 1, graphReady: 1, playableReady: 1 },
                devices: [{ deviceId: 'wasm-1', deviceType: 'fermenter', status: 'ready' }],
            });
        });

        it('restores the loading bypass when a promoted async node cannot join the graph', async () => {
            const deferred = installDeferredWasmDevice({ requiresContent: false });
            const readinessDiagnostics = createDeviceReadinessDiagnostics();
            const onDeviceRemoved = vi.fn();
            const track = new TrackNode('t1', makeDeps(ctx, { readinessDiagnostics, onDeviceRemoved }));
            track.addDevice('wasm-1', 'fermenter');
            vi.spyOn(track, 'rebuildChain').mockImplementationOnce(() => {
                throw new Error('promoted graph failed');
            });
            const loaded = createLoadedDevice();

            deferred.resolve(loaded.device);
            await Promise.resolve();

            expect(track.strip.deviceNodes[0]).toBe(deferred.placeholder);
            expect(track.getDeviceLoadState('wasm-1')).toBe('failed');
            expect(deferred.signal?.aborted).toBe(true);
            expect(onDeviceRemoved).toHaveBeenCalledWith('t1', loaded.device);
            expect(loaded.controller.destroy).toHaveBeenCalledTimes(1);
            expect(loaded.dispose).not.toHaveBeenCalled();
            expect(readinessDiagnostics.snapshot().devices).toMatchObject([
                { deviceId: 'wasm-1', status: 'failed', failureStage: 'graph' },
            ]);
        });

        it('records an unsupported device request as a node-stage failure', () => {
            const readinessDiagnostics = createDeviceReadinessDiagnostics();
            const track = new TrackNode('t1', makeDeps(ctx, { readinessDiagnostics }));

            track.addDevice('mystery-1', 'mystery-device');

            expect(readinessDiagnostics.snapshot()).toMatchObject({
                counts: { requested: 1, failed: 1 },
                devices: [{ deviceId: 'mystery-1', status: 'failed', failureStage: 'node' }],
            });

            track.removeDevice('mystery-1');
            expect(readinessDiagnostics.snapshot().devices).toEqual([]);
        });

        it('records a synchronous descriptor construction failure without retaining a pending token', () => {
            const readinessDiagnostics = createDeviceReadinessDiagnostics();
            mocks.findWasmDescriptor.mockReturnValue({
                requiresContent: false,
                matches: () => true,
                create: () => {
                    throw new Error('construction failed');
                },
            });
            const track = new TrackNode('t1', makeDeps(ctx, { readinessDiagnostics }));

            expect(() => track.addDevice('wasm-1', 'fermenter')).toThrow('construction failed');

            expect(readinessDiagnostics.snapshot()).toMatchObject({
                counts: { requested: 1, failed: 1 },
                devices: [{ deviceId: 'wasm-1', status: 'failed', failureStage: 'node' }],
            });
            expect(track.strip.deviceNodes).toHaveLength(0);

            track.dispose();
            expect(readinessDiagnostics.snapshot().devices).toEqual([]);
        });

        it('records a loaded-node promotion failure instead of leaving the device node-pending', () => {
            const deferred = installDeferredWasmDevice();
            const readinessDiagnostics = createDeviceReadinessDiagnostics();
            const onDeviceLoaded = vi.fn(() => {
                throw new Error('route connection failed');
            });
            let track: TrackNode;
            const onDeviceRemoved = vi.fn(() => {
                expect(track.strip.deviceNodes[0]).toBe(deferred.placeholder);
            });
            track = new TrackNode('t1', makeDeps(ctx, { readinessDiagnostics, onDeviceLoaded, onDeviceRemoved }));
            track.addDevice('wasm-1', 'levain');
            const loaded = createLoadedDevice();

            expect(() => deferred.resolve(loaded.device)).toThrow('route connection failed');

            expect(track.getDeviceLoadState('wasm-1')).toBe('failed');
            expect(readinessDiagnostics.snapshot()).toMatchObject({
                counts: { requested: 1, failed: 1 },
                devices: [{ deviceId: 'wasm-1', status: 'failed', failureStage: 'node' }],
            });
            expect(onDeviceRemoved).toHaveBeenCalledWith('t1', loaded.device);
            expect(loaded.dispose).toHaveBeenCalledTimes(1);
        });

        it('aborts an async generation when its placeholder graph cannot be connected', () => {
            const deferred = installDeferredWasmDevice();
            const pendingDevicePromises = new Set<Promise<unknown>>();
            const readinessDiagnostics = createDeviceReadinessDiagnostics();
            const track = new TrackNode('t1', makeDeps(ctx, { pendingDevicePromises, readinessDiagnostics }));
            vi.spyOn(track, 'rebuildChain').mockImplementationOnce(() => {
                throw new Error('placeholder graph failed');
            });

            expect(() => track.addDevice('wasm-1', 'levain')).toThrow('placeholder graph failed');

            expect(deferred.signal?.aborted).toBe(true);
            expect(pendingDevicePromises.size).toBe(0);
            expect(readinessDiagnostics.snapshot()).toMatchObject({
                counts: { requested: 1, failed: 1 },
                devices: [{ deviceId: 'wasm-1', status: 'failed', failureStage: 'graph' }],
            });

            track.dispose();
            expect(readinessDiagnostics.snapshot().devices).toEqual([]);
        });

        it('reports needs-reconcile when a pending placeholder cannot restore its graph after add failure', () => {
            const deferred = installDeferredWasmDevice();
            const pendingDevicePromises = new Set<Promise<unknown>>();
            const track = new TrackNode('t1', makeDeps(ctx, { pendingDevicePromises }));
            const rebuildError = new Error('placeholder graph rebuild failed');
            const rollbackError = new Error('placeholder graph rollback failed');
            vi.spyOn(track, 'rebuildChain')
                .mockImplementationOnce(() => {
                    throw rebuildError;
                })
                .mockImplementationOnce(() => {
                    throw rollbackError;
                });

            let failure: unknown;
            try {
                track.addDevice('wasm-1', 'levain');
            } catch (error) {
                failure = error;
            }

            expect(failure).toBeInstanceOf(RuntimeGraphMutationFailure);
            if (!(failure instanceof RuntimeGraphMutationFailure)) {
                throw new Error('Expected a runtime graph mutation failure');
            }
            expect(failure.cause).toBe(rebuildError);
            expect(failure.rollbackError).toBe(rollbackError);
            expect(failure.mutation).toMatchObject({ application: 'needs-reconcile' });
            expect(deferred.signal?.aborted).toBe(true);
            expect(pendingDevicePromises.size).toBe(0);
            expect(track.strip.deviceNodes).toHaveLength(0);
        });

        it('refuses to add the same device id twice', () => {
            const track = new TrackNode('t1', makeDeps(ctx));

            track.addDevice('gain-1', 'builtin-gain');
            track.addDevice('gain-1', 'builtin-gain');

            expect(track.strip.deviceNodes).toHaveLength(1);
            expect(mocks.loggerDebug).toHaveBeenCalledWith(expect.stringContaining('already exists'));
        });

        it('inserts a restored device after its nearest live project predecessor', () => {
            const track = new TrackNode('t1', makeDeps(ctx));
            track.addDevice('first', 'builtin-gain');
            track.addDevice('last', 'builtin-gain');

            track.addDevice('middle', 'builtin-gain', undefined, ['first']);

            expect(track.strip.deviceNodes.map((device) => device.deviceId)).toEqual(['first', 'middle', 'last']);
        });

        it('preserves project order when unsupported predecessors have no live node', () => {
            mocks.findWasmDescriptor.mockReturnValue(undefined);
            const track = new TrackNode('t1', makeDeps(ctx));
            track.addDevice('last', 'builtin-gain');
            track.addDevice('unsupported', 'mystery-device');

            track.addDevice('middle', 'builtin-gain', undefined, ['unsupported']);

            expect(track.strip.deviceNodes.map((device) => device.deviceId)).toEqual(['middle', 'last']);
        });

        it('adds nothing when the type has no factory and no wasm descriptor', () => {
            mocks.findWasmDescriptor.mockReturnValue(undefined);
            const track = new TrackNode('t1', makeDeps(ctx));

            track.addDevice('mystery-1', 'mystery-device');

            expect(track.strip.deviceNodes).toHaveLength(0);
        });

        it('replays placeholder parameter writes once and in order when a wasm device resolves', async () => {
            const deferred = installDeferredWasmDevice();
            const pendingDevicePromises = new Set<Promise<unknown>>();
            const onDeviceLoaded = vi.fn();
            const track = new TrackNode('t1', makeDeps(ctx, { pendingDevicePromises, onDeviceLoaded }));

            track.addDevice('wasm-1', 'levain');
            track.updateParam('wasm-1', 'gain', 0.25);
            track.updateParam('wasm-1', 'tone', 0.75);
            track.updateBypass('wasm-1', true);

            expect(track.strip.deviceNodes[0]).toBe(deferred.placeholder);
            expect(track.getDeviceLoadState('wasm-1')).toBe('pending');
            expect(pendingDevicePromises.size).toBe(1);

            const loaded = createLoadedDevice();
            deferred.resolve(loaded.device);
            expect(track.strip.deviceNodes[0]).toBe(loaded.device);
            expect(loaded.controller.setParam.mock.calls).toEqual([
                ['gain', 0.25],
                ['tone', 0.75],
            ]);
            expect(loaded.controller.setBypass).toHaveBeenCalledWith(true);
            expect(loaded.device.bypassed).toBe(true);
            expect(onDeviceLoaded).toHaveBeenCalledWith('t1', loaded.device);
            expect(track.getDeviceLoadState('wasm-1')).toBe('pending');
            deferred.settleContent('ready');
            expect(track.getDeviceLoadState('wasm-1')).toBe('pending');
            await Promise.resolve();
            expect(track.getDeviceLoadState('wasm-1')).toBe('ready');

            deferred.settle();
            await Promise.resolve();
            await Promise.resolve();
            expect(pendingDevicePromises.size).toBe(0);
        });

        it('reports exactly one owner-owned graph mutation when an async placeholder promotes and rebuilds', async () => {
            const deferred = installDeferredWasmDevice({ requiresContent: false });
            const onAsyncRuntimeGraphMutation = vi.fn();
            const track = new TrackNode('t1', makeDeps(ctx, { onAsyncRuntimeGraphMutation }));
            track.addDevice('wasm-1', 'levain');

            deferred.resolve(createLoadedDevice().device);
            await Promise.resolve();

            expect(onAsyncRuntimeGraphMutation).toHaveBeenCalledTimes(1);
            expect(onAsyncRuntimeGraphMutation).toHaveBeenCalledWith(
                expect.objectContaining({ application: 'applied' })
            );
        });

        it('reports reconciliation truth after a promoted async node rebuild fails and rolls back', async () => {
            const deferred = installDeferredWasmDevice({ requiresContent: false });
            const onAsyncRuntimeGraphMutation = vi.fn();
            const track = new TrackNode('t1', makeDeps(ctx, { onAsyncRuntimeGraphMutation }));
            track.addDevice('wasm-1', 'levain');
            vi.spyOn(track, 'rebuildChain').mockImplementationOnce(() => {
                throw new Error('promoted graph failed');
            });

            deferred.resolve(createLoadedDevice().device);
            await Promise.resolve();

            expect(onAsyncRuntimeGraphMutation).toHaveBeenNthCalledWith(
                1,
                expect.objectContaining({ application: 'applied' })
            );
            expect(onAsyncRuntimeGraphMutation).toHaveBeenNthCalledWith(
                2,
                expect.objectContaining({ application: 'needs-reconcile' })
            );
        });

        it('reports a settled descriptor-owned placeholder that never loaded as failed', async () => {
            const deferred = installDeferredWasmDevice({ controller: { setParam: vi.fn() } });
            const readinessDiagnostics = createDeviceReadinessDiagnostics();
            const track = new TrackNode('t1', makeDeps(ctx, { readinessDiagnostics }));

            track.addDevice('wasm-1', 'levain');
            expect(track.getDeviceLoadState('wasm-1')).toBe('pending');

            deferred.settle();
            await Promise.resolve();
            await Promise.resolve();

            expect(track.getDeviceLoadState('wasm-1')).toBe('failed');
            expect(readinessDiagnostics.snapshot()).toMatchObject({
                counts: { requested: 1, failed: 1 },
                devices: [{ deviceId: 'wasm-1', status: 'failed', failureStage: 'node' }],
            });
        });

        it('recovers a terminally failed loaded device once and preserves its bypass', async () => {
            const deferred = installDeferredWasmDevice();
            const readinessDiagnostics = createDeviceReadinessDiagnostics();
            const onAsyncRuntimeGraphMutation = vi.fn();
            const track = new TrackNode('t1', makeDeps(ctx, { readinessDiagnostics, onAsyncRuntimeGraphMutation }));
            track.addDevice('first', 'builtin-gain');
            track.addDevice('wasm-1', 'levain', undefined, ['first']);
            track.addDevice('last', 'builtin-gain');
            const loaded = createLoadedDevice();
            deferred.resolve(loaded.device);
            deferred.settleContent('ready');
            deferred.settle();
            await Promise.resolve();
            await Promise.resolve();
            expect(track.getDeviceLoadState('wasm-1')).toBe('ready');
            track.updateBypass('wasm-1', true);

            deferred.fail(loaded.device);
            await Promise.resolve();

            expect(deferred.generationCount).toBe(2);
            expect(track.strip.deviceNodes.map((device) => device.deviceId)).toEqual(['first', 'wasm-1', 'last']);
            expect(track.strip.deviceNodes[1]).toBe(deferred.placeholder);
            expect(track.getDeviceLoadState('wasm-1')).toBe('pending');
            expect(onAsyncRuntimeGraphMutation.mock.calls.map(([mutation]) => mutation.application)).toEqual([
                'applied',
                'needs-reconcile',
                'needs-reconcile',
            ]);

            const recovered = createLoadedDevice();
            deferred.resolve(recovered.device);
            deferred.settleContent('ready');
            deferred.settle();
            await Promise.resolve();
            await Promise.resolve();

            expect(track.strip.deviceNodes.map((device) => device.deviceId)).toEqual(['first', 'wasm-1', 'last']);
            expect(track.strip.deviceNodes[1]).toBe(recovered.device);
            expect(track.getDeviceLoadState('wasm-1')).toBe('ready');
            expect(recovered.controller.setBypass).toHaveBeenCalledWith(true);

            deferred.fail(recovered.device);
            await Promise.resolve();

            expect(deferred.generationCount).toBe(2);
            expect(track.strip.deviceNodes[1]).toBe(deferred.placeholder);
            expect(track.getDeviceLoadState('wasm-1')).toBe('failed');
            const diagnostics = readinessDiagnostics.snapshot();
            const failedDevice = diagnostics.devices.find((device) => device.deviceId === 'wasm-1');
            expect(diagnostics.counts).toMatchObject({ requested: 4, playableReady: 2, failed: 2 });
            expect(failedDevice).toMatchObject({ deviceId: 'wasm-1', status: 'failed', failureStage: 'runtime' });
        });

        it('cancels queued runtime recovery when the failed slot is removed', async () => {
            const deferred = installDeferredWasmDevice();
            const track = new TrackNode('t1', makeDeps(ctx));
            track.addDevice('wasm-1', 'levain');
            const loaded = createLoadedDevice();
            deferred.resolve(loaded.device);
            deferred.settle();
            await Promise.resolve();
            await Promise.resolve();

            deferred.fail(loaded.device);
            track.removeDevice('wasm-1');
            await Promise.resolve();

            expect(deferred.generationCount).toBe(1);
            expect(track.strip.deviceNodes).toEqual([]);
        });

        it('keeps a live device with failed content observable until removal', () => {
            const deferred = installDeferredWasmDevice();
            const readinessDiagnostics = createDeviceReadinessDiagnostics();
            const track = new TrackNode('t1', makeDeps(ctx, { readinessDiagnostics }));
            track.addDevice('wasm-1', 'builtin-crumbs');
            deferred.resolve(createLoadedDevice().device);

            deferred.settleContent('failed');

            expect(track.getDeviceLoadState('wasm-1')).toBe('failed');
            expect(readinessDiagnostics.snapshot()).toMatchObject({
                counts: { requested: 1, failed: 1 },
                devices: [{ deviceId: 'wasm-1', status: 'failed', failureStage: 'content' }],
            });
            expect(deferred.signal?.aborted).toBe(false);

            track.removeDevice('wasm-1');
            expect(deferred.signal?.aborted).toBe(true);
            expect(readinessDiagnostics.snapshot().devices).toEqual([]);
        });

        it('marks a timed-out descriptor load failed and rejects its late result', () => {
            const deferred = installDeferredWasmDevice({ controller: { setParam: vi.fn() } });
            const pendingDevicePromises = new Set<Promise<unknown>>();
            const readinessDiagnostics = createDeviceReadinessDiagnostics();
            const track = new TrackNode('t1', makeDeps(ctx, { pendingDevicePromises, readinessDiagnostics }));
            track.addDevice('wasm-1', 'levain');

            track.timeoutPendingDeviceLoads();

            expect(track.getDeviceLoadState('wasm-1')).toBe('failed');
            expect(pendingDevicePromises.size).toBe(0);
            expect(deferred.signal?.aborted).toBe(true);
            expect(readinessDiagnostics.snapshot()).toMatchObject({
                counts: { requested: 1, failed: 1 },
                devices: [{ deviceId: 'wasm-1', status: 'failed', failureStage: 'node' }],
            });
            const loaded = createLoadedDevice();
            deferred.resolve(loaded.device);
            expect(loaded.dispose).toHaveBeenCalledTimes(1);
        });

        it('aborts a timed-out content load after publishing its node', async () => {
            const deferred = installDeferredWasmDevice();
            const readinessDiagnostics = createDeviceReadinessDiagnostics();
            const track = new TrackNode('t1', makeDeps(ctx, { readinessDiagnostics }));
            track.addDevice('wasm-1', 'builtin-crumbs');
            const loaded = createLoadedDevice();
            deferred.resolve(loaded.device);
            await Promise.resolve();

            track.timeoutPendingDeviceLoads();
            await Promise.resolve();

            expect(deferred.signal?.aborted).toBe(true);
            expect(track.strip.deviceNodes[0]).toBe(deferred.placeholder);
            expect(loaded.controller.destroy).toHaveBeenCalledTimes(1);
            expect(loaded.dispose).not.toHaveBeenCalled();
            expect(readinessDiagnostics.snapshot()).toMatchObject({
                counts: { requested: 1, failed: 1 },
                devices: [{ deviceId: 'wasm-1', status: 'failed', failureStage: 'content' }],
            });
        });

        it('classifies a timeout before the published node joins the graph', () => {
            const deferred = installDeferredWasmDevice();
            const readinessDiagnostics = createDeviceReadinessDiagnostics();
            const track = new TrackNode('t1', makeDeps(ctx, { readinessDiagnostics }));
            track.addDevice('wasm-1', 'builtin-crumbs');
            deferred.resolve(createLoadedDevice().device);

            track.timeoutPendingDeviceLoads();

            expect(deferred.signal?.aborted).toBe(true);
            expect(readinessDiagnostics.snapshot()).toMatchObject({
                counts: { requested: 1, failed: 1 },
                devices: [{ deviceId: 'wasm-1', status: 'failed', failureStage: 'graph' }],
            });
        });

        it('preserves the descriptor-owned Proof parameter barrier', () => {
            const pendingParams: Array<[string, number]> = [];
            const order: string[] = [];
            const deferred = installDeferredWasmDevice({
                deviceId: 'proof-1',
                controller: { setParam: (name, value) => pendingParams.push([name, value]) },
                beforeLoaded: (finalDn) => {
                    for (const [name, value] of pendingParams) {
                        finalDn.controller?.setParam(name, value);
                    }
                    order.push('syncProofPatch');
                },
            });
            const track = new TrackNode('t1', makeDeps(ctx));
            track.addDevice('proof-1', 'proof');
            track.updateParam('proof-1', 'lim_ceiling', -1.5);
            const loaded = createLoadedDevice('proof-1');
            loaded.controller.setParam.mockImplementation(() => order.push('queuedParam'));

            deferred.resolve(loaded.device);

            expect(order).toEqual(['queuedParam', 'syncProofPatch']);
        });

        it('invalidates a removed placeholder and destroys its late wasm result', async () => {
            const deferred = installDeferredWasmDevice();
            const pendingDevicePromises = new Set<Promise<unknown>>();
            const onDeviceLoaded = vi.fn();
            const onAsyncRuntimeGraphMutation = vi.fn();
            const readinessDiagnostics = createDeviceReadinessDiagnostics();
            const track = new TrackNode(
                't1',
                makeDeps(ctx, {
                    pendingDevicePromises,
                    onDeviceLoaded,
                    onAsyncRuntimeGraphMutation,
                    readinessDiagnostics,
                })
            );
            track.addDevice('wasm-1', 'levain');
            const scheduleRebuild = vi.spyOn(track, 'scheduleRebuildChain');

            track.removeDevice('wasm-1');

            expect(track.strip.deviceNodes).toHaveLength(0);
            expect(pendingDevicePromises.size).toBe(0);
            const loaded = createLoadedDevice();
            deferred.resolve(loaded.device);
            expect(loaded.dispose).toHaveBeenCalledTimes(1);
            expect(loaded.controller.destroy).not.toHaveBeenCalled();
            expect(loaded.node.disconnect).toHaveBeenCalled();
            expect(scheduleRebuild).not.toHaveBeenCalled();
            expect(onDeviceLoaded).not.toHaveBeenCalled();
            expect(onAsyncRuntimeGraphMutation).not.toHaveBeenCalled();
            expect(readinessDiagnostics.snapshot()).toMatchObject({
                counts: { requested: 1, cancelled: 1 },
                devices: [],
            });

            deferred.settle();
            await Promise.resolve();
        });

        it('does not report or resurrect an async device after its track node is disposed', () => {
            const deferred = installDeferredWasmDevice();
            const onAsyncRuntimeGraphMutation = vi.fn();
            const track = new TrackNode('t1', makeDeps(ctx, { onAsyncRuntimeGraphMutation }));
            track.addDevice('wasm-1', 'levain');
            track.dispose();
            const loaded = createLoadedDevice();

            deferred.resolve(loaded.device);

            expect(track.strip.deviceNodes).toEqual([]);
            expect(loaded.dispose).toHaveBeenCalledTimes(1);
            expect(onAsyncRuntimeGraphMutation).not.toHaveBeenCalled();
        });

        it('does not report a second mutation when an already-promoted generation repeats its completion', async () => {
            const deferred = installDeferredWasmDevice({ requiresContent: false });
            const onAsyncRuntimeGraphMutation = vi.fn();
            const track = new TrackNode('t1', makeDeps(ctx, { onAsyncRuntimeGraphMutation }));
            track.addDevice('wasm-1', 'levain');
            deferred.resolve(createLoadedDevice().device);
            await Promise.resolve();
            const mutationCount = onAsyncRuntimeGraphMutation.mock.calls.length;
            const duplicate = createLoadedDevice();

            deferred.resolve(duplicate.device);

            expect(duplicate.dispose).toHaveBeenCalledTimes(1);
            expect(onAsyncRuntimeGraphMutation).toHaveBeenCalledTimes(mutationCount);
        });

        it('keeps same-id replacement readiness when a removed generation resolves late', async () => {
            const oldGeneration = installDeferredWasmDevice();
            const pendingDevicePromises = new Set<Promise<unknown>>();
            const readinessDiagnostics = createDeviceReadinessDiagnostics();
            const onAsyncRuntimeGraphMutation = vi.fn();
            const track = new TrackNode(
                't1',
                makeDeps(ctx, { pendingDevicePromises, readinessDiagnostics, onAsyncRuntimeGraphMutation })
            );
            track.addDevice('wasm-1', 'levain');

            track.removeDevice('wasm-1');
            const newGeneration = installDeferredWasmDevice();
            track.addDevice('wasm-1', 'levain');
            const newDevice = createLoadedDevice();
            newGeneration.resolve(newDevice.device);
            await Promise.resolve();
            const mutationsAfterCurrentPromotion = onAsyncRuntimeGraphMutation.mock.calls.length;

            expect(readinessDiagnostics.snapshot()).toMatchObject({
                counts: { requested: 2 },
                devices: [{ deviceId: 'wasm-1', status: 'content-pending' }],
            });

            const oldDevice = createLoadedDevice();
            oldGeneration.resolve(oldDevice.device);

            expect(oldDevice.dispose).toHaveBeenCalledTimes(1);
            expect(oldDevice.node.disconnect).toHaveBeenCalled();
            expect(track.strip.deviceNodes).toEqual([newDevice.device]);
            expect(onAsyncRuntimeGraphMutation).toHaveBeenCalledTimes(mutationsAfterCurrentPromotion);
            expect(readinessDiagnostics.snapshot().devices).toMatchObject([
                { deviceId: 'wasm-1', status: 'content-pending' },
            ]);

            newGeneration.settleContent('ready');
            expect(readinessDiagnostics.snapshot().devices).toMatchObject([{ deviceId: 'wasm-1', status: 'ready' }]);

            oldGeneration.settle();
            newGeneration.settle();
            await Promise.resolve();
        });
    });

    describe('dispose', () => {
        it('tears down strip nodes, closes the meter port, and destroys devices', () => {
            const track = new TrackNode('t1', makeDeps(ctx));
            const { node, controller } = pushControllerDevice(track);
            const meterNode = workletInstances[0]!;

            track.dispose();

            expect(meterNode.port.postMessage).toHaveBeenCalledWith({ type: 'shutdown' });
            expect(meterNode.port.close).toHaveBeenCalledTimes(1);
            expect(meterNode.disconnect).toHaveBeenCalled();
            expect(controller.destroy).toHaveBeenCalledTimes(1);
            expect(node.disconnect).toHaveBeenCalled();
            const gainNode = track.strip.gainNode as unknown as ReturnType<typeof createMockAudioNode<'gain'>>;
            expect(gainNode.disconnect).toHaveBeenCalled();
        });
    });
});
