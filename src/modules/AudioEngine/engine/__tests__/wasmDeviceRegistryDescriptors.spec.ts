import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockAudioContext, createMockAudioNode } from '#/helpers/__tests__/audioContext.mock';

import { type BuiltinDeviceNode } from '../../models/AudioEngineState';
import { externalLatencyRegistry } from '../../useCases/latencyCompensation/compensation/externalLatencyRegistry';
import { setAudioDeviceRuntimeSink } from '../audioDeviceRuntimeSink';
import { type BacteriaNodeResult } from '../BacteriaNode';
import { type GlutenNodeResult } from '../GlutenNode';
import { type GrandBouleNodeResult } from '../GrandBouleNode';
import { type GrinderNodeResult } from '../GrinderNode';
import { type KneadNodeResult } from '../KneadNode';
import { type LevainNodeResult } from '../LevainNode';
import { type ProofChamberNodeResult } from '../ProofChamberNode';
import { type ScoringNodeResult } from '../ScoringNode';
import { type ToasterNodeResult } from '../ToasterNode';
import { findWasmDescriptor, type WasmDeviceCreateDeps } from '../wasmDeviceRegistry';

const factoryMocks = vi.hoisted(() => ({
    createToasterNode: vi.fn(),
    createLevainNode: vi.fn(),
    createProofChamberNode: vi.fn(),
    createGlutenNode: vi.fn(),
    createBacteriaNode: vi.fn(),
    createGrinderNode: vi.fn(),
    createScoringNode: vi.fn(),
    createGrandBouleNode: vi.fn(),
    createKneadNode: vi.fn(),
    createFaustDeviceNode: vi.fn(),
    isFaustModule: vi.fn((moduleId: string) => moduleId === 'faust-flanger'),
    loggerWarn: vi.fn(),
}));

vi.mock('../ToasterNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../ToasterNode')>()),
    createToasterNode: factoryMocks.createToasterNode,
}));
vi.mock('../LevainNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../LevainNode')>()),
    createLevainNode: factoryMocks.createLevainNode,
}));
vi.mock('../ProofChamberNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../ProofChamberNode')>()),
    createProofChamberNode: factoryMocks.createProofChamberNode,
}));
vi.mock('../GlutenNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../GlutenNode')>()),
    createGlutenNode: factoryMocks.createGlutenNode,
}));
vi.mock('../BacteriaNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../BacteriaNode')>()),
    createBacteriaNode: factoryMocks.createBacteriaNode,
}));
vi.mock('../GrinderNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../GrinderNode')>()),
    createGrinderNode: factoryMocks.createGrinderNode,
}));
vi.mock('../ScoringNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../ScoringNode')>()),
    createScoringNode: factoryMocks.createScoringNode,
}));
vi.mock('../GrandBouleNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../GrandBouleNode')>()),
    createGrandBouleNode: factoryMocks.createGrandBouleNode,
}));
vi.mock('../KneadNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../KneadNode')>()),
    createKneadNode: factoryMocks.createKneadNode,
}));
vi.mock('../../useCases/deviceResolvers/createFaustDeviceNode', () => ({
    createFaustDeviceNode: factoryMocks.createFaustDeviceNode,
}));
vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/PluginHost/useCases')>()),
    isFaustModule: factoryMocks.isFaustModule,
}));
vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: factoryMocks.loggerWarn, debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

type RegistryAudioContext = ReturnType<typeof createMockAudioContext> & AudioContext;
type RegistryAudioWorkletNode = ReturnType<typeof createMockAudioNode<'audio-worklet'>> & AudioWorkletNode;
type RegistryGainNode = ReturnType<typeof createMockAudioNode<'gain'>> & GainNode;

function makeContext(): AudioContext {
    return createMockAudioContext() as RegistryAudioContext;
}

function makeWorkletNode(): AudioWorkletNode {
    return createMockAudioNode('audio-worklet') as RegistryAudioWorkletNode;
}

function makeGainNode(): GainNode {
    return createMockAudioNode('gain') as RegistryGainNode;
}

function createDeps(overrides?: Partial<WasmDeviceCreateDeps>): WasmDeviceCreateDeps {
    return {
        context: makeContext(),
        deviceId: 'dev-1',
        deviceType: 'toaster',
        isCurrent: () => true,
        onLoaded: vi.fn(),
        ...overrides,
    };
}

function lastLoadedNode(onLoaded: WasmDeviceCreateDeps['onLoaded']): BuiltinDeviceNode {
    const calls = vi.mocked(onLoaded).mock.calls;
    const call = calls[calls.length - 1];
    if (!call) {
        throw new Error('expected onLoaded to have been called');
    }
    return call[0];
}

function requireDescriptor(deviceType: string) {
    const descriptor = findWasmDescriptor(deviceType);
    if (!descriptor) {
        throw new Error(`expected a registered descriptor for ${deviceType}`);
    }
    return descriptor;
}

describe('wasmDeviceRegistry descriptors', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        factoryMocks.isFaustModule.mockImplementation((moduleId: string) => moduleId === 'faust-flanger');
        externalLatencyRegistry.clear();
        setAudioDeviceRuntimeSink({});
    });

    afterEach(() => {
        setAudioDeviceRuntimeSink({});
        externalLatencyRegistry.clear();
    });

    describe('toaster', () => {
        function makeToasterResult(): ToasterNodeResult {
            return {
                workletNode: makeWorkletNode(),
                outputNode: makeGainNode(),
                noteOn: vi.fn(),
                noteOff: vi.fn(),
                scheduleHit: vi.fn(),
                cancelScheduled: vi.fn(),
                allNotesOff: vi.fn(),
                setFillActive: vi.fn(),
                acceptsScheduledParam: vi.fn(),
                scheduleParam: vi.fn(),
                setParam: vi.fn(),
                setPadParam: vi.fn(),
                setPadDryRouted: vi.fn(),
                setBypass: vi.fn(),
                connectPadOutput: vi.fn(),
                disconnectPadOutput: vi.fn(),
                connect: vi.fn(),
                disconnect: vi.fn(),
                destroy: vi.fn(),
                ready: Promise.resolve({}),
            };
        }

        it('replays queued placeholder params in order once the worklet is loaded', async () => {
            const result = makeToasterResult();
            factoryMocks.createToasterNode.mockResolvedValue(result);
            const emitDeviceLoaded = vi.fn();
            setAudioDeviceRuntimeSink({ emitDeviceLoaded });
            const deps = createDeps({ deviceType: 'toaster', deviceId: 'toast-1' });

            const { placeholder, loadPromise } = requireDescriptor('toaster').create(deps);

            expect(placeholder.toasterControls?.ready).toBe(false);
            expect(placeholder.type).toBe('toaster');
            expect(placeholder.inputNode).toBe(placeholder.outputNode);
            placeholder.toasterControls?.setParam('swing', 0.3);
            placeholder.toasterControls?.setParam('volume', 0.9);
            expect(result.setParam).not.toHaveBeenCalled();

            await loadPromise;

            expect(result.setParam).toHaveBeenNthCalledWith(1, 'swing', 0.3);
            expect(result.setParam).toHaveBeenNthCalledWith(2, 'volume', 0.9);
            expect(emitDeviceLoaded).toHaveBeenCalledWith({ deviceId: 'toast-1', deviceType: 'toaster' });
            const loaded = lastLoadedNode(deps.onLoaded);
            expect(loaded.deviceId).toBe('toast-1');
            expect(loaded.inputNode).toBe(result.outputNode);
            expect(loaded.outputNode).toBe(result.outputNode);
            expect(loaded.nodes).toEqual([result.outputNode, result.workletNode]);
            expect(loaded.isGenerator).toBe(true);
            expect(loaded.toasterControls?.ready).toBe(true);
            expect(loaded.toasterControls?.scheduleHit).toBe(result.scheduleHit);
            expect(loaded.toasterControls?.cancelScheduled).toBe(result.cancelScheduled);
            expect(loaded.toasterControls?.allNotesOff).toBe(result.allNotesOff);
            expect(loaded.toasterControls?.setFillActive).toBe(result.setFillActive);
            expect(loaded.toasterControls?.setPadDryRouted).toBe(result.setPadDryRouted);
            expect(loaded.toasterControls?.connectPadOutput).toBe(result.connectPadOutput);
            expect(loaded.toasterControls?.disconnectPadOutput).toBe(result.disconnectPadOutput);

            vi.mocked(deps.onLoaded).mockReturnValue(false);
            emitDeviceLoaded.mockClear();
            await requireDescriptor('toaster').create(deps).loadPromise;
            expect(emitDeviceLoaded).not.toHaveBeenCalled();
        });

        it('emits device-removed (not a bare store delete) when the loaded controller is destroyed', async () => {
            const result = makeToasterResult();
            factoryMocks.createToasterNode.mockResolvedValue(result);
            const emitDeviceRemoved = vi.fn();
            setAudioDeviceRuntimeSink({ emitDeviceRemoved });
            const deps = createDeps({ deviceType: 'toaster', deviceId: 'toast-2' });

            const { loadPromise } = requireDescriptor('toaster').create(deps);
            await loadPromise;

            const loaded = lastLoadedNode(deps.onLoaded);
            loaded.controller?.destroy?.();

            expect(result.destroy).toHaveBeenCalledTimes(1);
            expect(emitDeviceRemoved).toHaveBeenCalledWith({ deviceId: 'toast-2', deviceType: 'toaster' });
        });

        it('resolves the load promise and skips onLoaded when the factory rejects', async () => {
            factoryMocks.createToasterNode.mockRejectedValue(new Error('wasm fetch failed'));
            const deps = createDeps({ deviceType: 'toaster' });

            const { loadPromise } = requireDescriptor('toaster').create(deps);

            await expect(loadPromise).resolves.toBeUndefined();
            expect(deps.onLoaded).not.toHaveBeenCalled();
            expect(factoryMocks.loggerWarn).toHaveBeenCalledWith(expect.stringContaining('toaster failed'));
        });
    });

    describe('levain', () => {
        function makeLevainResult(): LevainNodeResult {
            return {
                workletNode: makeWorkletNode(),
                noteOn: vi.fn(),
                noteOff: vi.fn(),
                noteExpression: vi.fn(),
                allNotesOff: vi.fn(),
                setParam: vi.fn(),
                handleCc: vi.fn(),
                setInstrument: vi.fn(),
                setBypass: vi.fn(),
                connect: vi.fn(),
                disconnect: vi.fn(),
                destroy: vi.fn(),
                ready: Promise.resolve({}),
            };
        }

        it('registers the runtime device with its port and flips engineReady on load', async () => {
            const result = makeLevainResult();
            factoryMocks.createLevainNode.mockResolvedValue(result);
            const registerLevainDevice = vi.fn();
            const setLevainEngineReady = vi.fn();
            setAudioDeviceRuntimeSink({ registerLevainDevice, setLevainEngineReady });
            const deps = createDeps({ deviceType: 'levain', deviceId: 'lev-1' });

            const { placeholder, loadPromise } = requireDescriptor('levain').create(deps);
            placeholder.levainControls?.setParam('cutoff', 0.4);
            await loadPromise;

            expect(result.setParam).toHaveBeenCalledWith('cutoff', 0.4);
            expect(registerLevainDevice).toHaveBeenCalledWith({
                deviceId: 'lev-1',
                device: {
                    setParam: result.setParam,
                    handleCc: result.handleCc,
                    setInstrument: result.setInstrument,
                },
                port: result.workletNode.port,
            });
            expect(setLevainEngineReady).toHaveBeenCalledWith({ deviceId: 'lev-1', isReady: true });

            vi.mocked(deps.onLoaded).mockReturnValue(false);
            registerLevainDevice.mockClear();
            setLevainEngineReady.mockClear();
            await requireDescriptor('levain').create(deps).loadPromise;
            expect(registerLevainDevice).not.toHaveBeenCalled();
            expect(setLevainEngineReady).not.toHaveBeenCalled();
        });

        it('reflects a post-ready worklet fault into engineReady=false', async () => {
            factoryMocks.createLevainNode.mockResolvedValue(makeLevainResult());
            const setLevainEngineReady = vi.fn();
            setAudioDeviceRuntimeSink({ setLevainEngineReady });
            const deps = createDeps({ deviceType: 'levain', deviceId: 'lev-2' });

            const { loadPromise } = requireDescriptor('levain').create(deps);
            await loadPromise;

            const onFault = factoryMocks.createLevainNode.mock.calls[0]?.[2] as (() => void) | undefined;
            if (!onFault) {
                throw new Error('expected createLevainNode to receive a fault callback');
            }
            setLevainEngineReady.mockClear();
            onFault();

            expect(setLevainEngineReady).toHaveBeenCalledWith({ deviceId: 'lev-2', isReady: false });
        });

        it('unregisters on controller destroy and survives an already-unregistered store', async () => {
            const result = makeLevainResult();
            factoryMocks.createLevainNode.mockResolvedValue(result);
            const unregisterLevainDevice = vi.fn(() => {
                throw new Error('already unregistered');
            });
            setAudioDeviceRuntimeSink({ unregisterLevainDevice });
            const deps = createDeps({ deviceType: 'levain', deviceId: 'lev-3' });

            const { loadPromise } = requireDescriptor('levain').create(deps);
            await loadPromise;

            const loaded = lastLoadedNode(deps.onLoaded);
            expect(() => loaded.controller?.destroy?.()).not.toThrow();
            expect(result.destroy).toHaveBeenCalledTimes(1);
            expect(unregisterLevainDevice).toHaveBeenCalledWith('lev-3');
        });
    });

    describe('dutch-oven (proof chamber)', () => {
        it('replays pending native-DSP params and exposes plain controls on load', async () => {
            const result: ProofChamberNodeResult = {
                workletNode: makeWorkletNode(),
                setParam: vi.fn(),
                acceptsScheduledParam: vi.fn(),
                scheduleParam: vi.fn(),
                setBypass: vi.fn(),
                connect: vi.fn(),
                disconnect: vi.fn(),
                destroy: vi.fn(),
                ready: Promise.resolve({ latency: 480 }),
            };
            factoryMocks.createProofChamberNode.mockResolvedValue(result);
            const deps = createDeps({ deviceType: 'dutch-oven', deviceId: 'oven-1' });

            const { placeholder, loadPromise } = requireDescriptor('dutch-oven').create(deps);
            placeholder.nativeDspControls?.setParam('temperature', 230);
            await loadPromise;

            expect(result.setParam).toHaveBeenCalledWith('temperature', 230);
            const loaded = lastLoadedNode(deps.onLoaded);
            expect(loaded.nativeDspControls).toEqual({ setParam: result.setParam, setBypass: result.setBypass });
            expect(loaded.controller).toEqual({
                setParam: result.setParam,
                setBypass: result.setBypass,
                destroy: expect.any(Function),
            });
            expect(externalLatencyRegistry.get('oven-1')).toBe(10);
            loaded.controller?.destroy?.();
            expect(externalLatencyRegistry.has('oven-1')).toBe(false);

            vi.mocked(result.destroy).mockClear();
            vi.mocked(deps.onLoaded).mockImplementation((node) => {
                node.dispose?.();
                return false;
            });
            await requireDescriptor('dutch-oven').create(deps).loadPromise;
            expect(result.destroy).toHaveBeenCalledTimes(1);
            expect(externalLatencyRegistry.has('oven-1')).toBe(false);
        });
    });

    describe('gluten', () => {
        it('routes meter data to the sink, reports latency in ms, and cleans both up on destroy', async () => {
            let meterCallback:
                | ((
                      data: Parameters<GlutenNodeResult['onMeterData']>[0] extends (data: infer D) => void ? D : never
                  ) => void)
                | undefined;
            const result: GlutenNodeResult = {
                workletNode: makeWorkletNode(),
                setParam: vi.fn(),
                setBypass: vi.fn(),
                onMeterData: vi.fn((cb) => {
                    meterCallback = cb;
                }),
                onLatencyChanged: vi.fn(),
                connect: vi.fn(),
                disconnect: vi.fn(),
                destroy: vi.fn(),
                ready: Promise.resolve({}),
            };
            factoryMocks.createGlutenNode.mockResolvedValue(result);
            const updateGlutenMeters = vi.fn();
            const deleteGlutenMeters = vi.fn();
            setAudioDeviceRuntimeSink({ updateGlutenMeters, deleteGlutenMeters });
            const deps = createDeps({ deviceType: 'gluten', deviceId: 'glu-1' });

            const { loadPromise } = requireDescriptor('gluten').create(deps);
            await loadPromise;

            if (!meterCallback) {
                throw new Error('expected the gluten meter callback to be registered');
            }
            meterCallback({
                grDb: -3,
                inputDb: -12,
                outputDb: -9,
                crest: 4,
                phaseCorr: 0.8,
                latency: 480,
            });

            expect(updateGlutenMeters).toHaveBeenCalledWith('glu-1', {
                grDb: -3,
                inputDb: -12,
                outputDb: -9,
                crest: 4,
                phaseCorr: 0.8,
                latency: 480,
            });
            // 480 samples at the 48 kHz mock context = 10 ms of reported latency.
            expect(externalLatencyRegistry.get('glu-1')).toBeCloseTo(10, 6);

            const loaded = lastLoadedNode(deps.onLoaded);
            loaded.controller?.destroy?.();
            expect(result.destroy).toHaveBeenCalledTimes(1);
            expect(externalLatencyRegistry.has('glu-1')).toBe(false);
            expect(deleteGlutenMeters).toHaveBeenCalledWith('glu-1');
        });
    });

    describe('bacteria', () => {
        function makeBacteriaResult(
            ready: Record<string, unknown> | Promise<Record<string, unknown>>
        ): BacteriaNodeResult & {
            emitLatency: (latency: number) => void;
        } {
            let latencyCallback: ((latency: number) => void) | undefined;
            return {
                workletNode: makeWorkletNode(),
                setParam: vi.fn(),
                setBypass: vi.fn(),
                onMeterData: vi.fn(),
                onLatencyChanged: vi.fn((cb) => {
                    latencyCallback = cb;
                }),
                connect: vi.fn(),
                disconnect: vi.fn(),
                destroy: vi.fn(),
                ready: Promise.resolve(ready),
                emitLatency: (latency: number) => latencyCallback?.(latency),
            };
        }

        it('reports the initial ready latency and follows later latency changes', async () => {
            const result = makeBacteriaResult({ latency: 96 });
            factoryMocks.createBacteriaNode.mockResolvedValue(result);
            const deps = createDeps({ deviceType: 'bacteria', deviceId: 'bac-1' });

            const { loadPromise } = requireDescriptor('bacteria').create(deps);
            await loadPromise;

            // 96 samples at 48 kHz = 2 ms.
            expect(externalLatencyRegistry.get('bac-1')).toBeCloseTo(2, 6);

            result.emitLatency(48);
            expect(externalLatencyRegistry.get('bac-1')).toBeCloseTo(1, 6);

            const loaded = lastLoadedNode(deps.onLoaded);
            loaded.controller?.destroy?.();
            expect(externalLatencyRegistry.has('bac-1')).toBe(false);
        });

        it('defaults the initial latency to zero when ready carries none', async () => {
            const result = makeBacteriaResult({});
            factoryMocks.createBacteriaNode.mockResolvedValue(result);
            const deps = createDeps({ deviceType: 'bacteria', deviceId: 'bac-2' });

            const { loadPromise } = requireDescriptor('bacteria').create(deps);
            await loadPromise;

            expect(externalLatencyRegistry.get('bac-2')).toBe(0);
        });

        it('destroys an invalidated late load before it reports latency or installs callbacks', async () => {
            const readiness = Promise.withResolvers<Record<string, unknown>>();
            const result = makeBacteriaResult(readiness.promise);
            factoryMocks.createBacteriaNode.mockResolvedValue(result);
            let current = true;
            const deps = createDeps({
                deviceType: 'bacteria',
                deviceId: 'bac-late',
                isCurrent: () => current,
            });

            const { loadPromise } = requireDescriptor('bacteria').create(deps);
            current = false;
            readiness.resolve({ latency: 96 });
            await loadPromise;

            expect(result.destroy).toHaveBeenCalledTimes(1);
            expect(deps.onLoaded).not.toHaveBeenCalled();
            expect(externalLatencyRegistry.has('bac-late')).toBe(false);
            expect(result.onLatencyChanged).not.toHaveBeenCalled();
            expect(result.onMeterData).not.toHaveBeenCalled();
        });
    });

    describe('grinder', () => {
        it('replays queued params, the pending patch, and the pending bypass on load', async () => {
            const result: GrinderNodeResult = {
                workletNode: makeWorkletNode(),
                setParam: vi.fn(),
                setPatch: vi.fn(),
                setBypass: vi.fn(),
                onMeterData: vi.fn(),
                onLatencyChanged: vi.fn(),
                connect: vi.fn(),
                disconnect: vi.fn(),
                destroy: vi.fn(),
                ready: Promise.resolve({ latency: 0 }),
            };
            factoryMocks.createGrinderNode.mockResolvedValue(result);
            const deps = createDeps({ deviceType: 'grinder', deviceId: 'grind-1' });

            const { placeholder, loadPromise } = requireDescriptor('grinder').create(deps);
            expect(placeholder.controller).toBeDefined();
            placeholder.controller?.setParam('drive', 0.7);
            placeholder.controller?.setPatch?.({ amp: 'lead' });
            placeholder.controller?.setBypass?.(true);
            await loadPromise;

            expect(result.setParam).toHaveBeenCalledWith('drive', 0.7);
            expect(result.setPatch).toHaveBeenCalledWith({ amp: 'lead' });
            expect(result.setBypass).toHaveBeenCalledWith(true);
        });

        it('destroys an invalidated late load before replaying state or reporting latency', async () => {
            const readiness = Promise.withResolvers<{ latency: number }>();
            const result: GrinderNodeResult = {
                workletNode: makeWorkletNode(),
                setParam: vi.fn(),
                setPatch: vi.fn(),
                setBypass: vi.fn(),
                onMeterData: vi.fn(),
                onLatencyChanged: vi.fn(),
                connect: vi.fn(),
                disconnect: vi.fn(),
                destroy: vi.fn(),
                ready: readiness.promise,
            };
            factoryMocks.createGrinderNode.mockResolvedValue(result);
            let current = true;
            const deps = createDeps({
                deviceType: 'grinder',
                deviceId: 'grind-late',
                isCurrent: () => current,
            });

            const { placeholder, loadPromise } = requireDescriptor('grinder').create(deps);
            placeholder.controller?.setParam('drive', 0.7);
            current = false;
            readiness.resolve({ latency: 96 });
            await loadPromise;

            expect(result.destroy).toHaveBeenCalledTimes(1);
            expect(deps.onLoaded).not.toHaveBeenCalled();
            expect(externalLatencyRegistry.has('grind-late')).toBe(false);
            expect(result.setParam).not.toHaveBeenCalled();
            expect(result.onLatencyChanged).not.toHaveBeenCalled();
            expect(result.onMeterData).not.toHaveBeenCalled();
        });

        it('forwards worklet telemetry frames to the grinder sink', async () => {
            let meterCallback:
                | ((
                      data: Parameters<GrinderNodeResult['onMeterData']>[0] extends (data: infer D) => void ? D : never
                  ) => void)
                | undefined;
            const result: GrinderNodeResult = {
                workletNode: makeWorkletNode(),
                setParam: vi.fn(),
                setPatch: vi.fn(),
                setBypass: vi.fn(),
                onMeterData: vi.fn((cb) => {
                    meterCallback = cb;
                }),
                onLatencyChanged: vi.fn(),
                connect: vi.fn(),
                disconnect: vi.fn(),
                destroy: vi.fn(),
                ready: Promise.resolve({ latency: 0 }),
            };
            factoryMocks.createGrinderNode.mockResolvedValue(result);
            const updateGrinderTelemetry = vi.fn();
            setAudioDeviceRuntimeSink({ updateGrinderTelemetry });
            const deps = createDeps({ deviceType: 'grinder', deviceId: 'grind-2' });

            const { loadPromise } = requireDescriptor('grinder').create(deps);
            await loadPromise;

            if (!meterCallback) {
                throw new Error('expected the grinder meter callback to be registered');
            }
            const frame = {
                inputDb: -20,
                preampDb: -10,
                powerAmpDb: -6,
                outputDb: -8,
                gateOpen: 1,
                gateEnvelopeDb: -40,
                sagVoltage: 0.9,
                latency: 64,
                neuralCpuPercent: 12,
                neuralWarmupProgress: 1,
            };
            meterCallback(frame);

            expect(updateGrinderTelemetry).toHaveBeenCalledWith('grind-2', frame);
        });
    });

    describe('native-scoring', () => {
        it('maps tuner telemetry fields into the sink', async () => {
            let telemetryCallback:
                | ((
                      data: Parameters<ScoringNodeResult['onTelemetry']>[0] extends (data: infer D) => void ? D : never
                  ) => void)
                | undefined;
            const result: ScoringNodeResult = {
                workletNode: makeWorkletNode(),
                setParam: vi.fn(),
                setBypass: vi.fn(),
                onTelemetry: vi.fn((cb) => {
                    telemetryCallback = cb;
                }),
                connect: vi.fn(),
                disconnect: vi.fn(),
                destroy: vi.fn(),
                ready: Promise.resolve({}),
            };
            factoryMocks.createScoringNode.mockResolvedValue(result);
            const updateTunerTelemetry = vi.fn();
            setAudioDeviceRuntimeSink({ updateTunerTelemetry });
            const deps = createDeps({ deviceType: 'native-scoring', deviceId: 'tune-1' });

            const { loadPromise } = requireDescriptor('native-scoring').create(deps);
            await loadPromise;

            if (!telemetryCallback) {
                throw new Error('expected the scoring telemetry callback to be registered');
            }
            telemetryCallback({
                frequency: 441.2,
                cents: 4.7,
                confidence: 0.98,
                noteIndex: 9,
                octave: 4,
                midiNote: 69,
                noteName: 'A',
                active: true,
            });

            expect(updateTunerTelemetry).toHaveBeenCalledWith('tune-1', {
                frequency: 441.2,
                cents: 4.7,
                confidence: 0.98,
                noteIndex: 9,
                octave: 4,
                midiNote: 69,
                noteName: 'A',
                active: true,
            });
        });
    });

    describe('grand-boule', () => {
        it('replays queued params and announces the loaded device', async () => {
            const result: GrandBouleNodeResult = {
                workletNode: makeWorkletNode(),
                noteOn: vi.fn(),
                noteOff: vi.fn(),
                noteExpression: vi.fn(),
                setParam: vi.fn(),
                setSustain: vi.fn(),
                setUnaCorda: vi.fn(),
                setSostenuto: vi.fn(),
                noteOnMidi2: vi.fn(),
                setTemperament: vi.fn(),
                loadAttackClip: vi.fn(),
                allNotesOff: vi.fn(),
                setBypass: vi.fn(),
                connect: vi.fn(),
                disconnect: vi.fn(),
                destroy: vi.fn(),
                ready: Promise.resolve({}),
            };
            factoryMocks.createGrandBouleNode.mockResolvedValue(result);
            const emitDeviceLoaded = vi.fn();
            setAudioDeviceRuntimeSink({ emitDeviceLoaded });
            const deps = createDeps({ deviceType: 'grand-boule', deviceId: 'gb-1' });

            const { placeholder, loadPromise } = requireDescriptor('grand-boule').create(deps);
            expect(placeholder.grandBouleControls?.ready).toBe(false);
            placeholder.grandBouleControls?.setParam('hammer-hardness', 0.6);
            await loadPromise;

            expect(result.setParam).toHaveBeenCalledWith('hammer-hardness', 0.6);
            expect(emitDeviceLoaded).toHaveBeenCalledWith({ deviceId: 'gb-1', deviceType: 'grand-boule' });
            const loaded = lastLoadedNode(deps.onLoaded);
            expect(loaded.grandBouleControls?.ready).toBe(true);
        });
    });

    describe('faust modules', () => {
        type FaustControls = {
            setParam: ReturnType<typeof vi.fn>;
            scheduleParam: ReturnType<typeof vi.fn>;
            keyOn: ReturnType<typeof vi.fn>;
            keyOff: ReturnType<typeof vi.fn>;
            destroy: ReturnType<typeof vi.fn>;
        };

        function makeFaustResult(): { controls: FaustControls; result: Record<string, unknown> } {
            const controls: FaustControls = {
                setParam: vi.fn(),
                scheduleParam: vi.fn(),
                keyOn: vi.fn(),
                keyOff: vi.fn(),
                destroy: vi.fn(),
            };
            const node = makeWorkletNode();
            return {
                controls,
                result: {
                    nodes: [node],
                    inputNode: node,
                    outputNode: node,
                    wamControls: controls,
                },
            };
        }

        it('matches through isFaustModule and replays pending params, scheduled params, and key events', async () => {
            const { controls, result } = makeFaustResult();
            factoryMocks.createFaustDeviceNode.mockResolvedValue(result);
            const emitDeviceLoaded = vi.fn();
            setAudioDeviceRuntimeSink({ emitDeviceLoaded });
            const deps = createDeps({ deviceType: 'faust-flanger', deviceId: 'faust-1' });

            const { placeholder, loadPromise } = requireDescriptor('faust-flanger').create(deps);
            placeholder.controller?.setParam('depth', 0.5);
            placeholder.controller?.scheduleParam?.('rate', 2, 1.25);
            placeholder.controller?.keyOn?.(0, 60, 100, 0.5);
            placeholder.controller?.keyOff?.(0, 60, 0, 1.0);
            await loadPromise;

            expect(controls.setParam).toHaveBeenCalledWith('depth', 0.5);
            expect(controls.scheduleParam).toHaveBeenCalledWith('rate', 2, 1.25);
            expect(controls.keyOn).toHaveBeenCalledWith(0, 60, 100, 0.5);
            expect(controls.keyOff).toHaveBeenCalledWith(0, 60, 0, 1.0);
            expect(emitDeviceLoaded).toHaveBeenCalledWith({ deviceId: 'faust-1', deviceType: 'faust-flanger' });
        });

        it('leaves the placeholder in place when the factory resolves null or without controls', async () => {
            factoryMocks.createFaustDeviceNode.mockResolvedValueOnce(null);
            const nullDeps = createDeps({ deviceType: 'faust-flanger', deviceId: 'faust-2' });
            const nullCreation = requireDescriptor('faust-flanger').create(nullDeps);
            await nullCreation.loadPromise;
            expect(nullDeps.onLoaded).not.toHaveBeenCalled();

            const node = makeWorkletNode();
            factoryMocks.createFaustDeviceNode.mockResolvedValueOnce({
                nodes: [node],
                inputNode: node,
                outputNode: node,
                wamControls: undefined,
            });
            const controllessDeps = createDeps({ deviceType: 'faust-flanger', deviceId: 'faust-3' });
            const controllessCreation = requireDescriptor('faust-flanger').create(controllessDeps);
            await controllessCreation.loadPromise;
            expect(controllessDeps.onLoaded).not.toHaveBeenCalled();
        });
    });

    describe('knead', () => {
        it('forwards the transport SAB to the factory and tears down via disconnect + port close', async () => {
            const workletNode = makeWorkletNode();
            const result: KneadNodeResult = {
                workletNode,
                setParam: vi.fn(),
                setBypass: vi.fn(),
                updateState: vi.fn(),
                ready: Promise.resolve({}),
            };
            factoryMocks.createKneadNode.mockResolvedValue(result);
            const transportSAB = new ArrayBuffer(16) as unknown as SharedArrayBuffer;
            const deps = createDeps({ deviceType: 'knead', deviceId: 'knead-1', transportSAB });

            const { placeholder, loadPromise } = requireDescriptor('knead').create(deps);
            expect(placeholder.kneadControls?.ready).toBe(false);
            placeholder.kneadControls?.setParam('shift_semitones', 3);
            await loadPromise;

            expect(factoryMocks.createKneadNode).toHaveBeenCalledWith(deps.context, transportSAB);
            expect(result.setParam).toHaveBeenCalledWith('shift_semitones', 3);

            const loaded = lastLoadedNode(deps.onLoaded);
            loaded.controller?.destroy?.();
            const mockNode = workletNode as RegistryAudioWorkletNode;
            expect(mockNode.disconnect).toHaveBeenCalledTimes(1);
            expect(mockNode.port.close).toHaveBeenCalledTimes(1);
        });

        it('still closes the worklet port when disconnect throws during teardown', async () => {
            const workletNode = makeWorkletNode();
            const mockNode = workletNode as RegistryAudioWorkletNode;
            mockNode.disconnect.mockImplementation(() => {
                throw new Error('already detached');
            });
            const result: KneadNodeResult = {
                workletNode,
                setParam: vi.fn(),
                setBypass: vi.fn(),
                updateState: vi.fn(),
                ready: Promise.resolve({}),
            };
            factoryMocks.createKneadNode.mockResolvedValue(result);
            const deps = createDeps({ deviceType: 'knead', deviceId: 'knead-2' });

            const { loadPromise } = requireDescriptor('knead').create(deps);
            await loadPromise;

            const loaded = lastLoadedNode(deps.onLoaded);
            expect(() => loaded.controller?.destroy?.()).not.toThrow();
            expect(mockNode.port.close).toHaveBeenCalledTimes(1);
        });
    });
});
