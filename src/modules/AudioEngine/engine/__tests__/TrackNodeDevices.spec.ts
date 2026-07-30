import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createMockAudioContext, createMockAudioNode } from '#/helpers/__tests__/audioContext.mock';

import { type BuiltinDeviceNode, type SendNode } from '../../models/AudioEngineState';
import { deviceReadinessDiagnostics, type DeviceContentLoadOutcome } from '../../services/deviceReadinessDiagnostics';
import { TrackNode, type TrackNodeDeps } from '../TrackNode';

const mocks = vi.hoisted(() => ({
    findWasmDescriptor: vi.fn(),
    loggerDebug: vi.fn(),
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
}: {
    deviceId?: string;
    controller?: BuiltinDeviceNode['controller'];
    beforeLoaded?: (finalDn: BuiltinDeviceNode) => void;
} = {}) {
    const placeholderNode = createMockAudioNode('gain');
    const placeholder: BuiltinDeviceNode = {
        deviceId,
        type: 'levain',
        nodes: [placeholderNode],
        inputNode: placeholderNode,
        outputNode: placeholderNode,
        controller,
    };
    let onLoaded: ((finalDn: BuiltinDeviceNode) => void) | undefined;
    let onContentLoadSettled: ((outcome: DeviceContentLoadOutcome) => void) | undefined;
    let signal: AbortSignal | undefined;
    const load = Promise.withResolvers<void>();
    mocks.findWasmDescriptor.mockReturnValue({
        matches: () => true,
        create: (deps: {
            onLoaded: (finalDn: BuiltinDeviceNode) => void;
            onContentLoadSettled?: (outcome: DeviceContentLoadOutcome) => void;
            signal?: AbortSignal;
        }) => {
            onLoaded = deps.onLoaded;
            onContentLoadSettled = deps.onContentLoadSettled;
            signal = deps.signal;
            return { placeholder, loadPromise: load.promise };
        },
    });
    return {
        placeholder,
        get signal(): AbortSignal | undefined {
            return signal;
        },
        resolve(finalDn: BuiltinDeviceNode): void {
            if (!onLoaded) {
                throw new Error('expected the deferred descriptor to capture onLoaded');
            }
            beforeLoaded?.(finalDn);
            onLoaded(finalDn);
        },
        settle: load.resolve,
        settleContent(outcome: DeviceContentLoadOutcome): void {
            onContentLoadSettled?.(outcome);
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
        mocks.findWasmDescriptor.mockReturnValue(undefined);
        deviceReadinessDiagnostics.reset();
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
        it('delegates pooled peak reads to the host meter transport', () => {
            const meterTransport = {
                read: vi.fn(() => 0.5),
                register: vi.fn(),
            } as unknown as NonNullable<TrackNodeDeps['meterTransport']>;
            const track = new TrackNode('t1', makeDeps(ctx, { meterTransport }));

            expect(track.getPeakLevel()).toBe(0.5);
            expect(meterTransport.read).toHaveBeenCalledWith('t1');
        });

        it('falls back to analyser time-domain peaks without a host meter transport', () => {
            const track = new TrackNode('t1', makeDeps(ctx));

            const analyser = track.strip.analyserNode as unknown as ReturnType<typeof createMockAudioNode<'analyser'>>;
            // The audible path remains direct regardless of whether a side tap exists.
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
            const workletCountBeforeDevice = workletInstances.length;

            track.addDevice('sc-1', 'builtin-sidechain-compressor');

            expect(workletInstances).toHaveLength(workletCountBeforeDevice + 1);
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
        it('refuses to add the same device id twice', () => {
            const track = new TrackNode('t1', makeDeps(ctx));

            track.addDevice('gain-1', 'builtin-gain');
            track.addDevice('gain-1', 'builtin-gain');

            expect(track.strip.deviceNodes).toHaveLength(1);
            expect(mocks.loggerDebug).toHaveBeenCalledWith(expect.stringContaining('already exists'));
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
            expect(track.getDeviceLoadState('wasm-1')).toBe('ready');

            await Promise.resolve();
            expect(deviceReadinessDiagnostics.snapshot().devices[0]).toMatchObject({
                deviceId: 'wasm-1',
                status: 'content-pending',
            });
            deferred.settleContent('ready');
            expect(deviceReadinessDiagnostics.snapshot().devices[0]).toMatchObject({
                deviceId: 'wasm-1',
                status: 'ready',
            });

            deferred.settle();
            await Promise.resolve();
            await Promise.resolve();
            expect(pendingDevicePromises.size).toBe(0);
        });

        it('reports a settled descriptor-owned placeholder that never loaded as failed', async () => {
            const deferred = installDeferredWasmDevice({ controller: { setParam: vi.fn() } });
            const track = new TrackNode('t1', makeDeps(ctx));

            track.addDevice('wasm-1', 'levain');
            expect(track.getDeviceLoadState('wasm-1')).toBe('pending');

            deferred.settle();
            await Promise.resolve();
            await Promise.resolve();

            expect(track.getDeviceLoadState('wasm-1')).toBe('failed');
        });

        it('marks a timed-out descriptor load failed and rejects its late result', () => {
            const deferred = installDeferredWasmDevice({ controller: { setParam: vi.fn() } });
            const pendingDevicePromises = new Set<Promise<unknown>>();
            const track = new TrackNode('t1', makeDeps(ctx, { pendingDevicePromises }));
            track.addDevice('wasm-1', 'levain');

            track.timeoutPendingDeviceLoads();

            expect(track.getDeviceLoadState('wasm-1')).toBe('failed');
            expect(pendingDevicePromises.size).toBe(0);
            expect(deferred.signal?.aborted).toBe(true);
            const loaded = createLoadedDevice();
            deferred.resolve(loaded.device);
            expect(loaded.dispose).toHaveBeenCalledTimes(1);
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
            const track = new TrackNode('t1', makeDeps(ctx, { pendingDevicePromises, onDeviceLoaded }));
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

            deferred.settle();
            await Promise.resolve();
        });

        it('keeps same-id replacement state when reset rejects an old generation', async () => {
            const deferred = installDeferredWasmDevice();
            const pendingDevicePromises = new Set<Promise<unknown>>();
            const track = new TrackNode('t1', makeDeps(ctx, { pendingDevicePromises }));
            track.addDevice('wasm-1', 'levain');
            const rebuildChain = vi.spyOn(track, 'rebuildChain');
            track.scheduleRebuildChain();

            track.dispose();
            track.dispose();
            await Promise.resolve();

            expect(track.strip.deviceNodes).toHaveLength(0);
            expect(pendingDevicePromises.size).toBe(0);
            expect(rebuildChain).not.toHaveBeenCalled();

            const loaded = createLoadedDevice();
            let activeGeneration = 'new';
            loaded.controller.destroy.mockImplementation(() => {
                activeGeneration = 'removed';
            });
            deferred.resolve(loaded.device);
            expect(loaded.dispose).toHaveBeenCalledTimes(1);
            expect(loaded.controller.destroy).not.toHaveBeenCalled();
            expect(activeGeneration).toBe('new');
            expect(loaded.node.disconnect).toHaveBeenCalled();
            expect(rebuildChain).not.toHaveBeenCalled();

            deferred.settle();
            await Promise.resolve();
        });
    });

    describe('dispose', () => {
        it('tears down strip nodes, releases its meter tap, and destroys devices', () => {
            const meterTransport = {
                register: vi.fn(),
                unregister: vi.fn(),
            } as unknown as NonNullable<TrackNodeDeps['meterTransport']>;
            const track = new TrackNode('t1', makeDeps(ctx, { meterTransport }));
            const { node, controller } = pushControllerDevice(track);

            track.dispose();

            expect(meterTransport.unregister).toHaveBeenCalledWith('t1');
            expect(controller.destroy).toHaveBeenCalledTimes(1);
            expect(node.disconnect).toHaveBeenCalled();
            const gainNode = track.strip.gainNode as unknown as ReturnType<typeof createMockAudioNode<'gain'>>;
            expect(gainNode.disconnect).toHaveBeenCalled();
        });
    });
});
