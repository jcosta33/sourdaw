import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockAudioContext, createMockAudioNode } from '#/helpers/__tests__/audioContext.mock';

import { type BuiltinDeviceNode } from '../../models/AudioEngineState';
import { externalLatencyRegistry } from '../../useCases/latencyCompensation/compensation/externalLatencyRegistry';
import { setAudioDeviceRuntimeSink } from '../audioDeviceRuntimeSink';
import { type BacteriaNodeResult } from '../BacteriaNode';
import { type CrumbsNodeResult } from '../CrumbsNode';
import { type CrustNodeResult } from '../CrustNode';
import { type DeviceContentLoadOutcome } from '../deviceReadinessDiagnostics';
import { type FermenterNodeResult } from '../FermenterNode';
import { type GlutenNodeResult } from '../GlutenNode';
import { type GrandBouleNodeResult } from '../GrandBouleNode';
import { type GrinderNodeResult } from '../GrinderNode';
import { type KneadNodeResult } from '../KneadNode';
import { type LevainNodeResult } from '../LevainNode';
import { type ProofChamberNodeResult } from '../ProofChamberNode';
import { type ProofNodeResult } from '../ProofNode';
import { type ScoringNodeResult } from '../ScoringNode';
import { type ToasterNodeResult } from '../ToasterNode';
import { findWasmDescriptor, type WasmDeviceCreateDeps } from '../wasmDeviceRegistry';

const factoryMocks = vi.hoisted(() => ({
    createFermenterNode: vi.fn(),
    createToasterNode: vi.fn(),
    createLevainNode: vi.fn(),
    createCrumbsNode: vi.fn(),
    createProofChamberNode: vi.fn(),
    createProofNode: vi.fn(),
    createGlutenNode: vi.fn(),
    createCrustNode: vi.fn(),
    createBacteriaNode: vi.fn(),
    createGrinderNode: vi.fn(),
    createScoringNode: vi.fn(),
    createGrandBouleNode: vi.fn(),
    createKneadNode: vi.fn(),
    createFaustDeviceNode: vi.fn(),
    isFaustModule: vi.fn((moduleId: string) => moduleId === 'faust-flanger'),
    loggerWarn: vi.fn(),
}));

vi.mock('../FermenterNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../FermenterNode')>()),
    createFermenterNode: factoryMocks.createFermenterNode,
}));

vi.mock('../ToasterNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../ToasterNode')>()),
    createToasterNode: factoryMocks.createToasterNode,
}));
vi.mock('../LevainNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../LevainNode')>()),
    createLevainNode: factoryMocks.createLevainNode,
}));
vi.mock('../CrumbsNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../CrumbsNode')>()),
    createCrumbsNode: factoryMocks.createCrumbsNode,
}));
vi.mock('../ProofChamberNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../ProofChamberNode')>()),
    createProofChamberNode: factoryMocks.createProofChamberNode,
}));
vi.mock('../ProofNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../ProofNode')>()),
    createProofNode: factoryMocks.createProofNode,
}));
vi.mock('../GlutenNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../GlutenNode')>()),
    createGlutenNode: factoryMocks.createGlutenNode,
}));
vi.mock('../CrustNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../CrustNode')>()),
    createCrustNode: factoryMocks.createCrustNode,
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

function isRuntimeFailureReporter(value: unknown): value is (message: string) => void {
    return typeof value === 'function';
}

function requireDescriptor(deviceType: string) {
    const descriptor = findWasmDescriptor(deviceType);
    if (!descriptor) {
        throw new Error(`expected a registered descriptor for ${deviceType}`);
    }
    return descriptor;
}

describe('wasmDeviceRegistry descriptors', () => {
    it('declares content readiness as registry metadata', () => {
        expect(findWasmDescriptor('levain')?.requiresContent).toBe(true);
        expect(findWasmDescriptor('fermenter')?.requiresContent).toBe(false);
        expect(findWasmDescriptor('toaster')?.requiresContent).toBe(false);
        expect(findWasmDescriptor('builtin-crumbs')?.requiresContent).toBe(true);
        expect(findWasmDescriptor('grand-boule')?.requiresContent).toBe(false);
    });

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

    describe('fermenter', () => {
        function makeFermenterResult(): FermenterNodeResult {
            return {
                workletNode: makeWorkletNode(),
                noteOn: vi.fn(),
                noteOff: vi.fn(),
                noteExpression: vi.fn(),
                allNotesOff: vi.fn(),
                setParam: vi.fn(),
                acceptsScheduledParam: vi.fn(),
                scheduleParam: vi.fn(),
                setPatch: vi.fn(),
                setBypass: vi.fn(),
                onTelemetry: vi.fn(),
                processorLifecycle: vi.fn(() => 'continue' as const),
                connect: vi.fn(),
                disconnect: vi.fn(),
                destroy: vi.fn(),
                ready: Promise.resolve({}),
            };
        }

        it('retires a faulted runtime before requesting one fresh generation', async () => {
            const result = makeFermenterResult();
            factoryMocks.createFermenterNode.mockResolvedValue(result);
            const replaceRuntimeFailure = vi.fn(() => true);
            const requestRuntimeRecovery = vi.fn();
            const deps = createDeps({
                deviceType: 'fermenter',
                deviceId: 'fermenter-failed',
                onRuntimeFailure: replaceRuntimeFailure,
                onRuntimeRecovery: requestRuntimeRecovery,
            });

            const { placeholder, loadPromise } = requireDescriptor('fermenter').create(deps);
            await loadPromise;
            const loaded = lastLoadedNode(deps.onLoaded);
            const factoryCall = factoryMocks.createFermenterNode.mock.calls.at(-1);
            const reportRuntimeFailure: unknown = factoryCall?.[2];
            if (!isRuntimeFailureReporter(reportRuntimeFailure)) {
                throw new TypeError('expected FermenterNode to report post-ready runtime failures');
            }

            reportRuntimeFailure('event queue overloaded');
            reportRuntimeFailure('duplicate failure');

            expect(loaded.controller?.ready).toBe(false);
            expect(loaded.fermenterControls?.ready).toBe(false);
            expect(replaceRuntimeFailure).toHaveBeenCalledOnce();
            expect(replaceRuntimeFailure).toHaveBeenCalledWith(loaded, placeholder);
            expect(result.destroy).toHaveBeenCalledOnce();
            expect(requestRuntimeRecovery).toHaveBeenCalledOnce();
            expect(requestRuntimeRecovery).toHaveBeenCalledWith(placeholder);
        });
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
                processorLifecycle: vi.fn(() => 'sleep' as const),
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
            expect(loaded.processorLifecycle?.()).toBe('sleep');
            expect(result.processorLifecycle).toHaveBeenCalledTimes(1);

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

        it('demotes and retires a loaded Toaster before requesting one fresh generation', async () => {
            const result = makeToasterResult();
            factoryMocks.createToasterNode.mockResolvedValue(result);
            const emitDeviceRemoved = vi.fn();
            setAudioDeviceRuntimeSink({ emitDeviceRemoved });
            const replaceRuntimeFailure = vi.fn(() => true);
            const requestRuntimeRecovery = vi.fn();
            const deps = createDeps({
                deviceType: 'toaster',
                deviceId: 'toast-failed',
                onRuntimeFailure: replaceRuntimeFailure,
                onRuntimeRecovery: requestRuntimeRecovery,
            });

            const { placeholder, loadPromise } = requireDescriptor('toaster').create(deps);
            await loadPromise;
            const loaded = lastLoadedNode(deps.onLoaded);
            const factoryCall = factoryMocks.createToasterNode.mock.calls.at(-1);
            const reportRuntimeFailure: unknown = factoryCall?.[2];
            if (!isRuntimeFailureReporter(reportRuntimeFailure)) {
                throw new TypeError('expected ToasterNode to report post-ready runtime failures');
            }

            reportRuntimeFailure('processor failed');
            reportRuntimeFailure('duplicate failure');

            expect(loaded.controller?.ready).toBe(false);
            expect(loaded.toasterControls?.ready).toBe(false);
            expect(replaceRuntimeFailure).toHaveBeenCalledOnce();
            expect(replaceRuntimeFailure).toHaveBeenCalledWith(loaded, placeholder);
            expect(result.destroy).toHaveBeenCalledOnce();
            expect(requestRuntimeRecovery).toHaveBeenCalledOnce();
            expect(requestRuntimeRecovery).toHaveBeenCalledWith(placeholder);
            expect(emitDeviceRemoved).not.toHaveBeenCalled();
        });

        it('does not remove newer runtime state when a stale failed Toaster is rejected', async () => {
            const result = makeToasterResult();
            factoryMocks.createToasterNode.mockResolvedValue(result);
            const emitDeviceRemoved = vi.fn();
            setAudioDeviceRuntimeSink({ emitDeviceRemoved });
            const replaceRuntimeFailure = vi.fn(() => false);
            const requestRuntimeRecovery = vi.fn();
            const deps = createDeps({
                deviceType: 'toaster',
                deviceId: 'toast-stale',
                onRuntimeFailure: replaceRuntimeFailure,
                onRuntimeRecovery: requestRuntimeRecovery,
            });

            const { loadPromise } = requireDescriptor('toaster').create(deps);
            await loadPromise;
            const factoryCall = factoryMocks.createToasterNode.mock.calls.at(-1);
            const reportRuntimeFailure: unknown = factoryCall?.[2];
            if (!isRuntimeFailureReporter(reportRuntimeFailure)) {
                throw new TypeError('expected ToasterNode to report post-ready runtime failures');
            }

            reportRuntimeFailure('stale processor failed');

            expect(replaceRuntimeFailure).toHaveBeenCalledOnce();
            expect(result.destroy).toHaveBeenCalledOnce();
            expect(requestRuntimeRecovery).not.toHaveBeenCalled();
            expect(emitDeviceRemoved).not.toHaveBeenCalled();
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
            const registerLevainDevice = vi.fn(() => Promise.resolve<DeviceContentLoadOutcome>('ready'));
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

        it('settles live content readiness from the generation sample-bank commit', async () => {
            const result = makeLevainResult();
            factoryMocks.createLevainNode.mockResolvedValue(result);
            const bankSettlement = Promise.withResolvers<DeviceContentLoadOutcome>();
            const registerLevainDevice = vi.fn(() => bankSettlement.promise);
            setAudioDeviceRuntimeSink({ registerLevainDevice });
            const onContentLoadSettled = vi.fn();
            const deps = createDeps({
                deviceType: 'levain',
                deviceId: 'lev-settlement',
                onContentLoadSettled,
            });

            const { loadPromise } = requireDescriptor('levain').create(deps);
            await vi.waitFor(() => expect(registerLevainDevice).toHaveBeenCalledOnce());
            expect(onContentLoadSettled).not.toHaveBeenCalled();

            bankSettlement.resolve('ready');
            await loadPromise;

            expect(onContentLoadSettled).toHaveBeenCalledOnce();
            expect(onContentLoadSettled).toHaveBeenCalledWith('ready');
        });

        it('demotes and tears down a Levain generation after a post-ready worklet fault', async () => {
            const result = makeLevainResult();
            factoryMocks.createLevainNode.mockResolvedValue(result);
            const setLevainEngineReady = vi.fn();
            const unregisterLevainDevice = vi.fn();
            setAudioDeviceRuntimeSink({ setLevainEngineReady, unregisterLevainDevice });
            const onRuntimeFailure = vi.fn(() => true);
            const onRuntimeRecovery = vi.fn();
            const deps = createDeps({
                deviceType: 'levain',
                deviceId: 'lev-2',
                onRuntimeFailure,
                onRuntimeRecovery,
            });

            const { placeholder, loadPromise } = requireDescriptor('levain').create(deps);
            await loadPromise;
            const loaded = lastLoadedNode(deps.onLoaded);

            const onFault = factoryMocks.createLevainNode.mock.calls[0]?.[2] as ((message: string) => void) | undefined;
            if (!onFault) {
                throw new Error('expected createLevainNode to receive a fault callback');
            }
            setLevainEngineReady.mockClear();
            onFault('levain processor crashed');

            expect(setLevainEngineReady).toHaveBeenCalledWith({ deviceId: 'lev-2', isReady: false });
            expect(onRuntimeFailure).toHaveBeenCalledWith(loaded, placeholder);
            expect(result.destroy).toHaveBeenCalledOnce();
            expect(unregisterLevainDevice).toHaveBeenCalledWith('lev-2');
            expect(onRuntimeRecovery).toHaveBeenCalledOnce();
            expect(onRuntimeRecovery).toHaveBeenCalledWith(placeholder);
        });

        it('does not recover or tear down newer Levain state when a stale fault is rejected', async () => {
            const result = makeLevainResult();
            factoryMocks.createLevainNode.mockResolvedValue(result);
            const setLevainEngineReady = vi.fn();
            const unregisterLevainDevice = vi.fn();
            setAudioDeviceRuntimeSink({ setLevainEngineReady, unregisterLevainDevice });
            const onRuntimeFailure = vi.fn(() => false);
            const onRuntimeRecovery = vi.fn();
            const deps = createDeps({
                deviceType: 'levain',
                deviceId: 'lev-stale',
                onRuntimeFailure,
                onRuntimeRecovery,
            });

            const { placeholder, loadPromise } = requireDescriptor('levain').create(deps);
            await loadPromise;
            const loaded = lastLoadedNode(deps.onLoaded);
            const reportRuntimeFailure: unknown = factoryMocks.createLevainNode.mock.calls.at(-1)?.[2];
            if (!isRuntimeFailureReporter(reportRuntimeFailure)) {
                throw new TypeError('expected LevainNode to report post-ready runtime failures');
            }
            setLevainEngineReady.mockClear();

            reportRuntimeFailure('stale Levain processor fault');

            expect(onRuntimeFailure).toHaveBeenCalledWith(loaded, placeholder);
            expect(onRuntimeRecovery).not.toHaveBeenCalled();
            expect(setLevainEngineReady).not.toHaveBeenCalled();
            expect(unregisterLevainDevice).not.toHaveBeenCalled();
            expect(result.destroy).not.toHaveBeenCalled();
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

    describe('crumbs', () => {
        function createResult(): CrumbsNodeResult {
            return {
                workletNode: makeWorkletNode(),
                noteOn: vi.fn(),
                noteOff: vi.fn(),
                allNotesOff: vi.fn(),
                allSoundOff: vi.fn(),
                setParam: vi.fn(),
                setMode: vi.fn(),
                setBypass: vi.fn(),
                connect: vi.fn(),
                disconnect: vi.fn(),
                destroy: vi.fn(),
                ready: Promise.resolve({}),
            };
        }

        it('settles content readiness only after project sample preparation completes', async () => {
            const preparation = Promise.withResolvers<DeviceContentLoadOutcome>();
            const prepareCrumbsDevice = vi.fn(() => preparation.promise);
            const onContentLoadSettled = vi.fn();
            const result = createResult();
            const controller = new AbortController();
            setAudioDeviceRuntimeSink({ prepareCrumbsDevice });
            factoryMocks.createCrumbsNode.mockResolvedValue(result);

            const { loadPromise } = requireDescriptor('builtin-crumbs').create(
                createDeps({ deviceType: 'builtin-crumbs', onContentLoadSettled, signal: controller.signal })
            );
            await vi.waitFor(() => {
                expect(prepareCrumbsDevice).toHaveBeenCalledWith({
                    deviceId: 'dev-1',
                    port: result.workletNode.port,
                    signal: controller.signal,
                });
            });
            expect(onContentLoadSettled).not.toHaveBeenCalled();

            preparation.resolve('ready');
            await loadPromise;
            expect(onContentLoadSettled).toHaveBeenCalledWith('ready');
        });

        it('reports project sample preparation failure as content failure', async () => {
            const onContentLoadSettled = vi.fn();
            setAudioDeviceRuntimeSink({
                prepareCrumbsDevice: vi.fn().mockRejectedValue(new Error('sample preparation failed')),
            });
            factoryMocks.createCrumbsNode.mockResolvedValue(createResult());

            const { loadPromise } = requireDescriptor('builtin-crumbs').create(
                createDeps({ deviceType: 'builtin-crumbs', onContentLoadSettled })
            );
            await loadPromise;

            expect(onContentLoadSettled).toHaveBeenCalledWith('failed');
        });

        it('demotes and tears down a Crumbs generation after a post-ready worklet fault', async () => {
            const result = createResult();
            factoryMocks.createCrumbsNode.mockResolvedValue(result);
            setAudioDeviceRuntimeSink({ prepareCrumbsDevice: vi.fn().mockResolvedValue('ready') });
            const onRuntimeFailure = vi.fn(() => true);
            const onRuntimeRecovery = vi.fn();
            const deps = createDeps({ deviceType: 'builtin-crumbs', onRuntimeFailure, onRuntimeRecovery });

            const { placeholder, loadPromise } = requireDescriptor('builtin-crumbs').create(deps);
            await loadPromise;
            const loaded = lastLoadedNode(deps.onLoaded);
            const reportRuntimeFailure: unknown = factoryMocks.createCrumbsNode.mock.calls.at(-1)?.[2];
            if (!isRuntimeFailureReporter(reportRuntimeFailure)) {
                throw new TypeError('expected CrumbsNode to report post-ready runtime failures');
            }

            reportRuntimeFailure('crumbs processor crashed');

            expect(onRuntimeFailure).toHaveBeenCalledWith(loaded, placeholder);
            expect(result.destroy).toHaveBeenCalledOnce();
            expect(onRuntimeRecovery).toHaveBeenCalledOnce();
            expect(onRuntimeRecovery).toHaveBeenCalledWith(placeholder);
        });

        it('does not recover or tear down newer Crumbs state when a stale fault is rejected', async () => {
            const result = createResult();
            factoryMocks.createCrumbsNode.mockResolvedValue(result);
            setAudioDeviceRuntimeSink({ prepareCrumbsDevice: vi.fn().mockResolvedValue('ready') });
            const onRuntimeFailure = vi.fn(() => false);
            const onRuntimeRecovery = vi.fn();
            const deps = createDeps({ deviceType: 'builtin-crumbs', onRuntimeFailure, onRuntimeRecovery });

            const { placeholder, loadPromise } = requireDescriptor('builtin-crumbs').create(deps);
            await loadPromise;
            const loaded = lastLoadedNode(deps.onLoaded);
            const reportRuntimeFailure: unknown = factoryMocks.createCrumbsNode.mock.calls.at(-1)?.[2];
            if (!isRuntimeFailureReporter(reportRuntimeFailure)) {
                throw new TypeError('expected CrumbsNode to report post-ready runtime failures');
            }

            reportRuntimeFailure('stale Crumbs processor fault');

            expect(onRuntimeFailure).toHaveBeenCalledWith(loaded, placeholder);
            expect(onRuntimeRecovery).not.toHaveBeenCalled();
            expect(result.destroy).not.toHaveBeenCalled();
        });

        it('reports a non-throwing project sample preparation failure as content failure', async () => {
            const onContentLoadSettled = vi.fn();
            setAudioDeviceRuntimeSink({
                prepareCrumbsDevice: vi.fn().mockResolvedValue('failed'),
            });
            factoryMocks.createCrumbsNode.mockResolvedValue(createResult());

            const { loadPromise } = requireDescriptor('builtin-crumbs').create(
                createDeps({ deviceType: 'builtin-crumbs', onContentLoadSettled })
            );
            await loadPromise;

            expect(onContentLoadSettled).toHaveBeenCalledWith('failed');
        });

        it('reports content cancellation when the owner rejects the loaded node', async () => {
            const prepareCrumbsDevice = vi.fn();
            const onContentLoadSettled = vi.fn();
            setAudioDeviceRuntimeSink({ prepareCrumbsDevice });
            factoryMocks.createCrumbsNode.mockResolvedValue(createResult());

            const { loadPromise } = requireDescriptor('builtin-crumbs').create(
                createDeps({
                    deviceType: 'builtin-crumbs',
                    onLoaded: vi.fn(() => false),
                    onContentLoadSettled,
                })
            );
            await loadPromise;

            expect(onContentLoadSettled).toHaveBeenCalledWith('cancelled');
            expect(prepareCrumbsDevice).not.toHaveBeenCalled();
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

    describe('proof', () => {
        it('keeps a healthy loaded Proof device ready and controllable until its runtime callback reports a fault', async () => {
            const result: ProofNodeResult = {
                workletNode: makeWorkletNode(),
                setParam: vi.fn(),
                setBypass: vi.fn(),
                reorderModules: vi.fn(),
                resetIntegrated: vi.fn(),
                onMeterData: vi.fn(),
                onLatencyChanged: vi.fn(),
                connect: vi.fn(),
                disconnect: vi.fn(),
                destroy: vi.fn(),
                ready: Promise.resolve({ latency: 128 }),
            };
            factoryMocks.createProofNode.mockResolvedValue(result);
            const replaceRuntimeFailure = vi.fn(() => true);
            const unregisterProofDevice = vi.fn();
            setAudioDeviceRuntimeSink({ unregisterProofDevice });
            const deps = createDeps({
                trackId: 'track-1',
                deviceType: 'proof',
                deviceId: 'proof-healthy',
                onRuntimeFailure: replaceRuntimeFailure,
            });

            await requireDescriptor('proof').create(deps).loadPromise;

            const loaded = lastLoadedNode(deps.onLoaded);
            expect(loaded.controller?.ready).toBe(true);
            loaded.controller?.setParam('lim_ceiling', -1);
            expect(result.setParam).toHaveBeenCalledWith('lim_ceiling', -1);
            expect(result.destroy).not.toHaveBeenCalled();
            expect(replaceRuntimeFailure).not.toHaveBeenCalled();
            expect(unregisterProofDevice).not.toHaveBeenCalled();
            expect(externalLatencyRegistry.has('proof-healthy')).toBe(true);
        });

        it('preserves an explicit invalid live target so Proof fails closed instead of selecting legacy raw controls', async () => {
            const result: ProofNodeResult = {
                workletNode: makeWorkletNode(),
                setParam: vi.fn(),
                setBypass: vi.fn(),
                reorderModules: vi.fn(),
                resetIntegrated: vi.fn(),
                onMeterData: vi.fn(),
                onLatencyChanged: vi.fn(),
                connect: vi.fn(),
                disconnect: vi.fn(),
                destroy: vi.fn(),
                ready: Promise.resolve({ latency: 0 }),
            };
            factoryMocks.createProofNode.mockResolvedValue(result);
            const parameterIds = Object.freeze(['lim_ceiling']);
            const deps = createDeps({
                trackId: '',
                deviceType: 'proof',
                deviceId: 'proof-invalid-live-target',
                parameterIds,
            });

            await requireDescriptor('proof').create(deps).loadPromise;

            expect(factoryMocks.createProofNode).toHaveBeenCalledWith(
                deps.context,
                undefined,
                deps.signal,
                {
                    trackId: '',
                    deviceId: 'proof-invalid-live-target',
                    deviceType: 'proof',
                    parameterIds,
                },
                expect.any(Function)
            );
        });

        it('replaces the TrackNode-facing controller after a terminal runtime fault so later writes cannot grow the loading queue', async () => {
            const result: ProofNodeResult = {
                workletNode: makeWorkletNode(),
                setParam: vi.fn(),
                setBypass: vi.fn(),
                reorderModules: vi.fn(),
                resetIntegrated: vi.fn(),
                onMeterData: vi.fn(),
                onLatencyChanged: vi.fn(),
                connect: vi.fn(),
                disconnect: vi.fn(),
                destroy: vi.fn(),
                ready: Promise.resolve({ latency: 128 }),
            };
            factoryMocks.createProofNode.mockResolvedValue(result);
            const onRuntimeFailure = vi.fn(() => true);
            const deps = createDeps({
                trackId: 'track-1',
                deviceType: 'proof',
                deviceId: 'proof-fault',
                onRuntimeFailure,
            });
            const { placeholder, loadPromise } = requireDescriptor('proof').create(deps);
            const loadingController = placeholder.controller;
            await loadPromise;
            const reportRuntimeFailure = factoryMocks.createProofNode.mock.calls[0]?.[4];
            if (!isRuntimeFailureReporter(reportRuntimeFailure)) {
                throw new TypeError('expected ProofNode to receive a post-ready runtime failure callback');
            }
            reportRuntimeFailure('processor trapped');
            expect(placeholder.controller).not.toBe(loadingController);
            expect(placeholder.controller?.ready).toBe(false);
            placeholder.controller?.setParam('lim_ceiling', -1);
            placeholder.controller?.setParam('input_gain', 2);
            expect(result.setParam).not.toHaveBeenCalled();
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

    describe('crust', () => {
        function makeCrustResult(): CrustNodeResult {
            return {
                workletNode: makeWorkletNode(),
                setParam: vi.fn(),
                setBypass: vi.fn(),
                onMeterData: vi.fn(),
                onLatencyChanged: vi.fn(),
                connect: vi.fn(),
                disconnect: vi.fn(),
                destroy: vi.fn(),
                ready: Promise.resolve({ latency: 128 }),
            };
        }

        it('retires a post-ready fault, clears latency and meters, and does not request default recovery', async () => {
            const result = makeCrustResult();
            factoryMocks.createCrustNode.mockResolvedValue(result);
            const replaceRuntimeFailure = vi.fn(() => true);
            const requestRuntimeRecovery = vi.fn();
            const deleteCrustMeters = vi.fn();
            setAudioDeviceRuntimeSink({ deleteCrustMeters });
            const deps = createDeps({
                deviceType: 'crust',
                deviceId: 'crust-failed',
                trackId: 'track-1',
                parameterIds: ['ceiling'],
                onRuntimeFailure: replaceRuntimeFailure,
                onRuntimeRecovery: requestRuntimeRecovery,
            });

            const { placeholder, loadPromise } = requireDescriptor('crust').create(deps);
            await loadPromise;
            const loaded = lastLoadedNode(deps.onLoaded);
            const factoryCall = factoryMocks.createCrustNode.mock.calls.at(-1);
            const reportRuntimeFailure: unknown = factoryCall?.[4];
            if (!isRuntimeFailureReporter(reportRuntimeFailure)) {
                throw new TypeError('expected CrustNode to report post-ready runtime failures');
            }

            reportRuntimeFailure('wasm trap');
            reportRuntimeFailure('duplicate failure');

            expect(loaded.controller?.ready).toBe(false);
            expect(replaceRuntimeFailure).toHaveBeenCalledOnce();
            expect(replaceRuntimeFailure).toHaveBeenCalledWith(loaded, placeholder);
            expect(result.destroy).toHaveBeenCalledOnce();
            expect(deleteCrustMeters).toHaveBeenCalledWith('crust-failed');
            expect(externalLatencyRegistry.get('crust-failed')).toBeUndefined();
            expect(requestRuntimeRecovery).not.toHaveBeenCalled();
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

        it('retires a post-ready fault into the loading bypass without default recovery', async () => {
            const result = makeBacteriaResult({ latency: 96 });
            factoryMocks.createBacteriaNode.mockResolvedValue(result);
            const updateBacteriaMeters = vi.fn();
            const onRuntimeFailure = vi.fn(() => true);
            const onRuntimeRecovery = vi.fn();
            setAudioDeviceRuntimeSink({ updateBacteriaMeters });
            const deps = createDeps({
                deviceType: 'bacteria',
                deviceId: 'bac-fault',
                onRuntimeFailure,
                onRuntimeRecovery,
            });

            const { placeholder, loadPromise } = requireDescriptor('bacteria').create(deps);
            await loadPromise;
            const loaded = lastLoadedNode(deps.onLoaded);
            const reporter = factoryMocks.createBacteriaNode.mock.calls[0]?.[4];
            if (!isRuntimeFailureReporter(reporter)) {
                throw new Error('expected Bacteria runtime failure reporter');
            }
            reporter('WASM panic');

            expect(onRuntimeFailure).toHaveBeenCalledWith(loaded, placeholder);
            expect(result.destroy).toHaveBeenCalledTimes(1);
            expect(externalLatencyRegistry.has('bac-fault')).toBe(false);
            expect(updateBacteriaMeters).toHaveBeenCalledWith('bac-fault', {
                inputDb: 0,
                outputDb: 0,
                bandLevels: [0, 0, 0, 0, 0, 0],
                latency: 0,
            });
            expect(onRuntimeRecovery).not.toHaveBeenCalled();
        });

        it('destroys an invalidated late load before it reports latency or installs callbacks', async () => {
            const readiness = Promise.withResolvers<Record<string, unknown>>();
            const result = makeBacteriaResult(readiness.promise);
            factoryMocks.createBacteriaNode.mockResolvedValue(result);
            const abortController = new AbortController();
            const deps = createDeps({
                deviceType: 'bacteria',
                deviceId: 'bac-late',
                signal: abortController.signal,
            });

            const { loadPromise } = requireDescriptor('bacteria').create(deps);
            await Promise.resolve();
            abortController.abort();
            await loadPromise;

            expect(result.destroy).toHaveBeenCalledTimes(1);
            expect(deps.onLoaded).not.toHaveBeenCalled();
            expect(externalLatencyRegistry.has('bac-late')).toBe(false);
            expect(result.onLatencyChanged).not.toHaveBeenCalled();
            expect(result.onMeterData).not.toHaveBeenCalled();
        });
    });

    describe('crumbs', () => {
        function makeCrumbsResult(ready: Promise<Record<string, unknown>>): CrumbsNodeResult {
            return {
                workletNode: makeWorkletNode(),
                noteOn: vi.fn(),
                noteOff: vi.fn(),
                allNotesOff: vi.fn(),
                allSoundOff: vi.fn(),
                setParam: vi.fn(),
                setMode: vi.fn(),
                setBypass: vi.fn(),
                connect: vi.fn(),
                disconnect: vi.fn(),
                destroy: vi.fn(),
                ready,
            };
        }

        it('threads cancellation into construction and destroys a node invalidated before readiness', async () => {
            const readiness = Promise.withResolvers<Record<string, unknown>>();
            const result = makeCrumbsResult(readiness.promise);
            factoryMocks.createCrumbsNode.mockResolvedValue(result);
            const abortController = new AbortController();
            const deps = createDeps({
                deviceType: 'builtin-crumbs',
                deviceId: 'crumbs-late',
                signal: abortController.signal,
            });

            const { loadPromise } = requireDescriptor('builtin-crumbs').create(deps);
            await Promise.resolve();
            abortController.abort();
            readiness.resolve({});
            await loadPromise;

            expect(factoryMocks.createCrumbsNode).toHaveBeenCalledExactlyOnceWith(
                deps.context,
                undefined,
                expect.any(Function),
                abortController.signal
            );
            expect(result.destroy).toHaveBeenCalledTimes(1);
            expect(deps.onLoaded).not.toHaveBeenCalled();
        });
    });

    describe('grinder', () => {
        it('preserves scheduled queued params and coalesces immediate queued params on load', async () => {
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
            const parameterIds = Object.freeze(['drive', 'sag']);
            const deps = createDeps({
                trackId: 'track-1',
                deviceType: 'grinder',
                deviceId: 'grind-1',
                parameterIds,
            });

            const { placeholder, loadPromise } = requireDescriptor('grinder').create(deps);
            expect(factoryMocks.createGrinderNode).toHaveBeenCalledWith(
                deps.context,
                undefined,
                deps.signal,
                {
                    trackId: 'track-1',
                    deviceId: 'grind-1',
                    deviceType: 'grinder',
                    parameterIds,
                },
                expect.any(Function)
            );
            expect(placeholder.controller).toBeDefined();
            placeholder.controller?.setParam('drive', 0.2);
            placeholder.controller?.setParam('drive', 0.7);
            placeholder.controller?.setParam('gain', 0.1);
            placeholder.controller?.setParam('tone', 0.2);
            placeholder.controller?.setParam('gain', 0.9);
            placeholder.controller?.setParam('sag', 0.25, 48_000);
            placeholder.controller?.setParam('sag', 0.75, 96_000);
            placeholder.controller?.setParam('sag', 0.9);
            placeholder.controller?.setPatch?.({ amp: 'lead' });
            placeholder.controller?.setBypass?.(true);
            await loadPromise;

            expect(vi.mocked(result.setParam).mock.calls).toEqual([
                ['drive', 0.7],
                ['gain', 0.1],
                ['tone', 0.2],
                ['gain', 0.9],
                ['sag', 0.25, 48_000],
                ['sag', 0.75, 96_000],
                ['sag', 0.9],
            ]);
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
            const abortController = new AbortController();
            const deps = createDeps({
                deviceType: 'grinder',
                deviceId: 'grind-late',
                signal: abortController.signal,
            });

            const { placeholder, loadPromise } = requireDescriptor('grinder').create(deps);
            placeholder.controller?.setParam('drive', 0.7);
            await Promise.resolve();
            abortController.abort();
            await loadPromise;

            expect(result.destroy).toHaveBeenCalledTimes(1);
            expect(deps.onLoaded).not.toHaveBeenCalled();
            expect(externalLatencyRegistry.has('grind-late')).toBe(false);
            expect(result.setParam).not.toHaveBeenCalled();
            expect(result.onLatencyChanged).not.toHaveBeenCalled();
            expect(result.onMeterData).not.toHaveBeenCalled();
        });

        it('reconciles a post-ready neural-patch processor fault through the owning runtime callback', async () => {
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
                ready: Promise.resolve({ latency: 128 }),
            };
            factoryMocks.createGrinderNode.mockResolvedValue(result);
            const onRuntimeFailure = vi.fn(() => true);
            const onRuntimeRecovery = vi.fn();
            const deps = createDeps({
                trackId: 'track-1',
                deviceType: 'grinder',
                deviceId: 'grind-fault',
                onRuntimeFailure,
                onRuntimeRecovery,
            });

            const { placeholder, loadPromise } = requireDescriptor('grinder').create(deps);
            await loadPromise;
            const loaded = lastLoadedNode(deps.onLoaded);
            expect(externalLatencyRegistry.has('grind-fault')).toBe(true);
            const reportRuntimeFailure = factoryMocks.createGrinderNode.mock.calls[0]?.[4];
            if (typeof reportRuntimeFailure !== 'function') {
                throw new TypeError('expected GrinderNode to receive a post-ready runtime failure callback');
            }

            loaded.controller?.setPatch?.({ neuralModelMode: 'builtin' });
            expect(result.setPatch).toHaveBeenCalledWith({ neuralModelMode: 'builtin' });
            reportRuntimeFailure('neural patch set_param trapped after partial mutation');

            expect(onRuntimeFailure).toHaveBeenCalledWith(loaded, placeholder);
            expect(loaded.controller?.ready).toBe(false);
            expect(result.destroy).toHaveBeenCalledOnce();
            expect(externalLatencyRegistry.has('grind-fault')).toBe(false);
            expect(onRuntimeRecovery).toHaveBeenCalledWith(placeholder);
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
        function makeGrandBouleResult(): GrandBouleNodeResult {
            return {
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
        }

        it('replays queued params and announces the loaded device', async () => {
            const result = makeGrandBouleResult();
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
            expect(loaded.workerInstances).toBe(1);
        });

        it('demotes a loaded device when its engine worker fails', async () => {
            const result = makeGrandBouleResult();
            factoryMocks.createGrandBouleNode.mockResolvedValue(result);
            const emitDeviceRemoved = vi.fn();
            setAudioDeviceRuntimeSink({ emitDeviceRemoved });
            const deps = createDeps({ deviceType: 'grand-boule', deviceId: 'gb-failed' });

            const { loadPromise } = requireDescriptor('grand-boule').create(deps);
            await loadPromise;
            const loaded = lastLoadedNode(deps.onLoaded);
            const factoryCall = factoryMocks.createGrandBouleNode.mock.calls.at(-1);
            const reportRuntimeFailure: unknown = factoryCall?.[2];
            if (!isRuntimeFailureReporter(reportRuntimeFailure)) {
                throw new TypeError('expected GrandBouleNode to report post-ready runtime failures');
            }

            reportRuntimeFailure('render failed');
            reportRuntimeFailure('duplicate failure');

            expect({
                controllerReady: loaded.controller?.ready,
                deviceReady: loaded.grandBouleControls?.ready,
                workerInstances: loaded.workerInstances,
            }).toEqual({ controllerReady: false, deviceReady: false, workerInstances: 0 });
            expect(result.destroy).toHaveBeenCalledOnce();
            expect(emitDeviceRemoved).toHaveBeenCalledWith({ deviceId: 'gb-failed', deviceType: 'grand-boule' });
            expect(emitDeviceRemoved).toHaveBeenCalledOnce();
        });

        it('does not publish a device that faults before ownership promotion', async () => {
            const result = makeGrandBouleResult();
            factoryMocks.createGrandBouleNode.mockResolvedValue(result);
            const emitDeviceLoaded = vi.fn();
            const emitDeviceRemoved = vi.fn();
            setAudioDeviceRuntimeSink({ emitDeviceLoaded, emitDeviceRemoved });
            const deps = createDeps({ deviceType: 'grand-boule', deviceId: 'gb-raced' });

            const { loadPromise } = requireDescriptor('grand-boule').create(deps);
            const factoryCall = factoryMocks.createGrandBouleNode.mock.calls.at(-1);
            const reportRuntimeFailure: unknown = factoryCall?.[2];
            if (!isRuntimeFailureReporter(reportRuntimeFailure)) {
                throw new TypeError('expected GrandBouleNode to report post-ready runtime failures');
            }
            reportRuntimeFailure('failed during promotion');
            await loadPromise;

            expect(deps.onLoaded).not.toHaveBeenCalled();
            expect(result.destroy).toHaveBeenCalledOnce();
            expect(emitDeviceLoaded).not.toHaveBeenCalled();
            expect(emitDeviceRemoved).not.toHaveBeenCalled();
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

        it('destroys a delayed result after cancellation without replaying queued events', async () => {
            const deferred = Promise.withResolvers<Record<string, unknown>>();
            const { controls, result } = makeFaustResult();
            factoryMocks.createFaustDeviceNode.mockReturnValue(deferred.promise);
            const abortController = new AbortController();
            const deps = createDeps({
                deviceType: 'faust-flanger',
                deviceId: 'faust-late',
                signal: abortController.signal,
            });

            const { placeholder, loadPromise } = requireDescriptor('faust-flanger').create(deps);
            placeholder.controller?.setParam('depth', 0.5);
            placeholder.controller?.keyOn?.(0, 60, 100, 0.5);
            abortController.abort();
            deferred.resolve(result);
            await loadPromise;

            expect(controls.destroy).toHaveBeenCalledTimes(1);
            expect(controls.setParam).not.toHaveBeenCalled();
            expect(controls.keyOn).not.toHaveBeenCalled();
            expect(deps.onLoaded).not.toHaveBeenCalled();
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
                destroy: () => {
                    try {
                        workletNode.disconnect();
                    } catch {
                        // The node may already be detached during teardown.
                    }
                    workletNode.port.close();
                },
                ready: Promise.resolve({}),
            };
            factoryMocks.createKneadNode.mockResolvedValue(result);
            const transportSAB = new ArrayBuffer(16) as unknown as SharedArrayBuffer;
            const signal = new AbortController().signal;
            const deps = createDeps({ deviceType: 'knead', deviceId: 'knead-1', transportSAB, signal });

            const { placeholder, loadPromise } = requireDescriptor('knead').create(deps);
            expect(placeholder.kneadControls?.ready).toBe(false);
            placeholder.kneadControls?.setParam('shift_semitones', 3);
            await loadPromise;

            expect(factoryMocks.createKneadNode).toHaveBeenCalledWith(deps.context, transportSAB, signal);
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
                destroy: () => {
                    try {
                        workletNode.disconnect();
                    } catch {
                        // The node may already be detached during teardown.
                    }
                    workletNode.port.close();
                },
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

        // Knead buffers a whole 2048-sample analysis frame before emitting, so it
        // delays its track by 2047 samples even at zero shift. It reported nothing
        // to PDC, so the vocal on three shipped templates sat ~43 ms behind the mix
        // with every other device compensated. ADR 0016 ruling 3: report it.
        it('reports the ready-handshake latency to PDC in milliseconds and retracts it on destroy', async () => {
            const result: KneadNodeResult = {
                workletNode: makeWorkletNode(),
                setParam: vi.fn(),
                setBypass: vi.fn(),
                updateState: vi.fn(),
                destroy: vi.fn(),
                ready: Promise.resolve({ latency: 2047 }),
            };
            factoryMocks.createKneadNode.mockResolvedValue(result);
            const deps = createDeps({ deviceType: 'knead', deviceId: 'knead-pdc' });

            const { loadPromise } = requireDescriptor('knead').create(deps);
            await loadPromise;

            // 2047 samples at the 48 kHz mock context = 42.6458… ms.
            expect(externalLatencyRegistry.get('knead-pdc')).toBeCloseTo((2047 / 48000) * 1000, 6);

            const loaded = lastLoadedNode(deps.onLoaded);
            loaded.controller?.destroy?.();
            expect(result.destroy).toHaveBeenCalledTimes(1);
            // A retained entry would keep compensating a delay no longer in the graph.
            expect(externalLatencyRegistry.has('knead-pdc')).toBe(false);
        });

        it('reports zero rather than NaN when the ready handshake carries no latency', async () => {
            const result: KneadNodeResult = {
                workletNode: makeWorkletNode(),
                setParam: vi.fn(),
                setBypass: vi.fn(),
                updateState: vi.fn(),
                destroy: vi.fn(),
                ready: Promise.resolve({}),
            };
            factoryMocks.createKneadNode.mockResolvedValue(result);
            const deps = createDeps({ deviceType: 'knead', deviceId: 'knead-nolat' });

            await requireDescriptor('knead').create(deps).loadPromise;

            expect(externalLatencyRegistry.get('knead-nolat')).toBe(0);
        });
    });
});
