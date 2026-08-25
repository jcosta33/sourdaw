import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockAudioContext, createMockAudioNode } from '#/helpers/__tests__/audioContext.mock';

import { type BuiltinDeviceNode } from '../../models/AudioEngineState';
import { externalLatencyRegistry } from '../../useCases/latencyCompensation/compensation/externalLatencyRegistry';
import { setAudioDeviceRuntimeSink } from '../audioDeviceRuntimeSink';
import { type FermenterNodeResult } from '../FermenterNode';
import { type ProofNodeResult } from '../ProofNode';
import { findReleasedWasmDescriptor, findWasmDescriptor } from '../wasmDeviceRegistry';

const proofNodeMocks = vi.hoisted(() => ({
    createProofNode: vi.fn(),
    destroy: vi.fn(),
    onLatencyChanged: vi.fn(),
    onMeterData: vi.fn(),
    reorderModules: vi.fn(),
    resetIntegrated: vi.fn(),
    setBypass: vi.fn(),
    setParam: vi.fn(),
}));

vi.mock('../ProofNode', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../ProofNode')>();
    return { ...actual, createProofNode: proofNodeMocks.createProofNode };
});

const fermenterNodeMocks = vi.hoisted(() => ({
    createFermenterNode: vi.fn(),
    allNotesOff: vi.fn(),
    destroy: vi.fn(),
    noteOff: vi.fn(),
    noteOn: vi.fn(),
    onTelemetry: vi.fn(),
    processorLifecycle: vi.fn(() => 'sleep' as const),
    setBypass: vi.fn(),
    setParam: vi.fn(),
    setPatch: vi.fn(),
}));

vi.mock('../FermenterNode', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../FermenterNode')>();
    return { ...actual, createFermenterNode: fermenterNodeMocks.createFermenterNode };
});

const REGISTERED_WASM_DEVICE_TYPES = [
    'fermenter',
    'toaster',
    'levain',
    'dutch-oven',
    'gluten',
    'bacteria',
    'grinder',
    'proof',
    'native-scoring',
    'grand-boule',
] as const;

type RegistryAudioContext = ReturnType<typeof createMockAudioContext> & AudioContext;
type RegistryAudioWorkletNode = ReturnType<typeof createMockAudioNode<'audio-worklet'>> & AudioWorkletNode;

describe('findWasmDescriptor', () => {
    beforeEach(() => {
        proofNodeMocks.createProofNode.mockReset();
        proofNodeMocks.destroy.mockReset();
        proofNodeMocks.onLatencyChanged.mockReset();
        proofNodeMocks.onMeterData.mockReset();
        proofNodeMocks.reorderModules.mockReset();
        proofNodeMocks.resetIntegrated.mockReset();
        proofNodeMocks.setBypass.mockReset();
        proofNodeMocks.setParam.mockReset();
        externalLatencyRegistry.clear();
        setAudioDeviceRuntimeSink({});
    });

    afterEach(() => {
        setAudioDeviceRuntimeSink({});
        externalLatencyRegistry.clear();
    });

    it('should return the descriptor for each registered WASM device type', () => {
        for (const type of REGISTERED_WASM_DEVICE_TYPES) {
            const desc = findWasmDescriptor(type);
            expect(desc, type).toBeDefined();
            expect(desc!.matches(type)).toBe(true);
        }
    });

    it('should not return a descriptor for unknown device types', () => {
        expect(findWasmDescriptor('unknown-plugin')).toBeUndefined();
        expect(findWasmDescriptor('')).toBeUndefined();
    });

    it('publishes Grand Boule through the released runtime registry', () => {
        expect(findWasmDescriptor('grand-boule')).toBeDefined();
        expect(findReleasedWasmDescriptor('grand-boule')).toBeDefined();
    });

    it('should apply the validated Proof patch after queued restored flat params', async () => {
        const syncProofPatch = vi.fn(() => {
            proofNodeMocks.setParam('lim_ceiling', -1);
        });
        const registerProofDevice = vi.fn();
        proofNodeMocks.createProofNode.mockResolvedValue(createProofNodeResult());
        setAudioDeviceRuntimeSink({ registerProofDevice, syncProofPatch });

        const desc = findWasmDescriptor('proof');
        if (!desc) {
            throw new Error('Expected proof descriptor to be registered');
        }

        const { placeholder, loadPromise } = desc.create({
            context: createRegistryAudioContext(),
            deviceId: 'proof-1',
            deviceType: 'proof',
            onLoaded: vi.fn(),
        });

        if (!placeholder.controller) {
            throw new Error('Expected proof placeholder to expose loading controller');
        }
        expect(placeholder.nativeDspControls).toBe(placeholder.controller);
        placeholder.controller.setParam('lim_ceiling', 0.1);

        await loadPromise;

        expect(registerProofDevice).toHaveBeenCalledTimes(1);
        expect(syncProofPatch).toHaveBeenCalledTimes(1);
        expect(syncProofPatch).toHaveBeenCalledWith('proof-1');
        expect(proofNodeMocks.setParam).toHaveBeenCalledTimes(2);
        expect(proofNodeMocks.setParam).toHaveBeenNthCalledWith(1, 'lim_ceiling', 0.1);
        expect(proofNodeMocks.setParam).toHaveBeenNthCalledWith(2, 'lim_ceiling', -1);
    });

    it('should apply the complete Proof patch after direct flat params are queued', async () => {
        const onLoaded = vi.fn();
        const syncProofPatch = vi.fn(() => {
            proofNodeMocks.setParam('input_gain', 3);
            proofNodeMocks.setParam('lim_ceiling', -0.1);
        });
        proofNodeMocks.createProofNode.mockResolvedValue(createProofNodeResult());
        setAudioDeviceRuntimeSink({ syncProofPatch });

        const desc = findWasmDescriptor('proof');
        if (!desc) {
            throw new Error('Expected proof descriptor to be registered');
        }

        const { placeholder, loadPromise } = desc.create({
            context: createRegistryAudioContext(),
            deviceId: 'proof-1',
            deviceType: 'proof',
            onLoaded,
        });

        if (!placeholder.controller) {
            throw new Error('Expected proof placeholder to expose loading controller');
        }
        placeholder.controller.setParam('lim_ceiling', -1.5);

        await loadPromise;

        expect(syncProofPatch).toHaveBeenCalledTimes(1);
        expect(proofNodeMocks.setParam).toHaveBeenCalledTimes(3);
        expect(proofNodeMocks.setParam).toHaveBeenNthCalledWith(1, 'lim_ceiling', -1.5);
        expect(proofNodeMocks.setParam).toHaveBeenNthCalledWith(2, 'input_gain', 3);
        expect(proofNodeMocks.setParam).toHaveBeenNthCalledWith(3, 'lim_ceiling', -0.1);
        expect(onLoaded).toHaveBeenCalledTimes(1);
        const syncCallOrder = syncProofPatch.mock.invocationCallOrder[0];
        const loadedCallOrder = onLoaded.mock.invocationCallOrder[0];
        if (syncCallOrder === undefined || loadedCallOrder === undefined) {
            throw new Error('Expected sync and load call order to be recorded');
        }
        expect(syncCallOrder).toBeLessThan(loadedCallOrder);
    });

    it('should keep the placeholder when patch sync throws and clean up the ready node', async () => {
        const onLoaded = vi.fn();
        const registerProofDevice = vi.fn();
        const unregisterProofDevice = vi.fn();
        const syncProofPatch = vi.fn(() => {
            throw new Error('patch sync failed');
        });
        proofNodeMocks.createProofNode.mockResolvedValue(createProofNodeResult());
        setAudioDeviceRuntimeSink({ registerProofDevice, unregisterProofDevice, syncProofPatch });

        const desc = findWasmDescriptor('proof');
        if (!desc) {
            throw new Error('Expected proof descriptor to be registered');
        }

        const { placeholder, loadPromise } = desc.create({
            context: createRegistryAudioContext(),
            deviceId: 'proof-1',
            deviceType: 'proof',
            onLoaded,
        });

        if (!placeholder.controller) {
            throw new Error('Expected proof placeholder to expose loading controller');
        }
        placeholder.controller.setParam('lim_ceiling', -1.5);

        await loadPromise;

        expect(syncProofPatch).toHaveBeenCalledTimes(1);
        expect(registerProofDevice).toHaveBeenCalledTimes(1);
        expect(unregisterProofDevice).toHaveBeenCalledWith('proof-1');
        expect(onLoaded).not.toHaveBeenCalled();
        expect(proofNodeMocks.onLatencyChanged).not.toHaveBeenCalled();
        expect(proofNodeMocks.onMeterData).not.toHaveBeenCalled();
        expect(proofNodeMocks.destroy).toHaveBeenCalledTimes(1);
        expect(externalLatencyRegistry.has('proof-1')).toBe(false);
        expect(proofNodeMocks.setParam).toHaveBeenCalledTimes(1);
        expect(proofNodeMocks.setParam).toHaveBeenCalledWith('lim_ceiling', -1.5);
    });

    it('should still sync a real in-memory Proof patch when no flat params are queued', async () => {
        const syncProofPatch = vi.fn();
        proofNodeMocks.createProofNode.mockResolvedValue(createProofNodeResult());
        setAudioDeviceRuntimeSink({ syncProofPatch });

        const desc = findWasmDescriptor('proof');
        if (!desc) {
            throw new Error('Expected proof descriptor to be registered');
        }

        const { loadPromise } = desc.create({
            context: createRegistryAudioContext(),
            deviceId: 'proof-1',
            deviceType: 'proof',
            onLoaded: vi.fn(),
        });

        await loadPromise;

        expect(syncProofPatch).toHaveBeenCalledTimes(1);
        expect(syncProofPatch).toHaveBeenCalledWith('proof-1');
    });

    it('wires the Fermenter allNotesOff surface into the loaded controller (TrackNode bypass coverage)', async () => {
        // TrackNode.updateBypass releases held voices via controller.allNotesOff
        // on bypass entry. Without this wiring the mechanism silently skips
        // Fermenter and held voices keep sounding through bypass.
        const onLoaded = vi.fn();
        fermenterNodeMocks.createFermenterNode.mockResolvedValue(createFermenterNodeResult());

        const desc = findWasmDescriptor('fermenter');
        if (!desc) {
            throw new Error('Expected fermenter descriptor to be registered');
        }

        const { loadPromise } = desc.create({
            context: createRegistryAudioContext(),
            deviceId: 'ferm-1',
            deviceType: 'fermenter',
            onLoaded,
        });

        await loadPromise;

        expect(onLoaded).toHaveBeenCalledTimes(1);
        const loadedNode = onLoaded.mock.calls[0]![0] as BuiltinDeviceNode;
        if (!loadedNode.controller?.allNotesOff) {
            throw new Error('Expected loaded fermenter controller to expose allNotesOff');
        }
        loadedNode.controller.allNotesOff();
        expect(fermenterNodeMocks.allNotesOff).toHaveBeenCalledTimes(1);
        expect(loadedNode.processorLifecycle?.()).toBe('sleep');
        expect(fermenterNodeMocks.processorLifecycle).toHaveBeenCalledTimes(1);
    });
});

function createRegistryAudioContext(): AudioContext {
    return createMockAudioContext() as RegistryAudioContext;
}

function createRegistryAudioWorkletNode(): AudioWorkletNode {
    return createMockAudioNode('audio-worklet') as RegistryAudioWorkletNode;
}

function createProofNodeResult(): ProofNodeResult {
    return {
        connect: vi.fn(),
        destroy: proofNodeMocks.destroy,
        disconnect: vi.fn(),
        onLatencyChanged: proofNodeMocks.onLatencyChanged,
        onMeterData: proofNodeMocks.onMeterData,
        ready: Promise.resolve({ latency: 0 }),
        reorderModules: proofNodeMocks.reorderModules,
        resetIntegrated: proofNodeMocks.resetIntegrated,
        setBypass: proofNodeMocks.setBypass,
        setParam: proofNodeMocks.setParam,
        workletNode: createRegistryAudioWorkletNode(),
    };
}

function createFermenterNodeResult(): FermenterNodeResult {
    return {
        allNotesOff: fermenterNodeMocks.allNotesOff,
        connect: vi.fn(),
        destroy: fermenterNodeMocks.destroy,
        disconnect: vi.fn(),
        noteExpression: vi.fn(),
        noteOff: fermenterNodeMocks.noteOff,
        noteOn: fermenterNodeMocks.noteOn,
        onTelemetry: fermenterNodeMocks.onTelemetry,
        processorLifecycle: fermenterNodeMocks.processorLifecycle,
        ready: Promise.resolve({}),
        setBypass: fermenterNodeMocks.setBypass,
        setParam: fermenterNodeMocks.setParam,
        setPatch: fermenterNodeMocks.setPatch,
        workletNode: createRegistryAudioWorkletNode(),
    };
}
