import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockAudioContext, createMockAudioNode } from '#/helpers/__tests__/audioContext.mock';

import { setAudioDeviceRuntimeSink } from '../audioDeviceRuntimeSink';
import { type ProofNodeResult } from '../ProofNode';
import { findWasmDescriptor } from '../wasmDeviceRegistry';

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
        setAudioDeviceRuntimeSink({});
    });

    afterEach(() => {
        setAudioDeviceRuntimeSink({});
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

    it('should replay queued restored flat params after Proof patch sync', async () => {
        const syncProofPatch = vi.fn(() => {
            proofNodeMocks.setParam('lim_ceiling', -0.1);
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

        if (!placeholder.nativeDspControls) {
            throw new Error('Expected proof placeholder to expose native DSP controls');
        }
        placeholder.nativeDspControls.setParam('lim_ceiling', -1.5);

        await loadPromise;

        expect(registerProofDevice).toHaveBeenCalledTimes(1);
        expect(syncProofPatch).toHaveBeenCalledTimes(1);
        expect(syncProofPatch).toHaveBeenCalledWith('proof-1');
        expect(proofNodeMocks.setParam).toHaveBeenCalledTimes(2);
        expect(proofNodeMocks.setParam).toHaveBeenNthCalledWith(1, 'lim_ceiling', -0.1);
        expect(proofNodeMocks.setParam).toHaveBeenNthCalledWith(2, 'lim_ceiling', -1.5);
    });

    it('should preserve real Proof patch sync when direct flat params are queued', async () => {
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
            onLoaded: vi.fn(),
        });

        if (!placeholder.nativeDspControls) {
            throw new Error('Expected proof placeholder to expose native DSP controls');
        }
        placeholder.nativeDspControls.setParam('lim_ceiling', -1.5);

        await loadPromise;

        expect(syncProofPatch).toHaveBeenCalledTimes(1);
        expect(proofNodeMocks.setParam).toHaveBeenCalledTimes(3);
        expect(proofNodeMocks.setParam).toHaveBeenNthCalledWith(1, 'input_gain', 3);
        expect(proofNodeMocks.setParam).toHaveBeenNthCalledWith(2, 'lim_ceiling', -0.1);
        expect(proofNodeMocks.setParam).toHaveBeenNthCalledWith(3, 'lim_ceiling', -1.5);
    });

    it('should install the ready Proof node even when patch sync throws', async () => {
        const onLoaded = vi.fn();
        const syncProofPatch = vi.fn(() => {
            throw new Error('patch sync failed');
        });
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
            onLoaded,
        });

        await loadPromise;

        expect(syncProofPatch).toHaveBeenCalledTimes(1);
        expect(onLoaded).toHaveBeenCalledTimes(1);
        expect(onLoaded).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'proof-1', type: 'proof' }));
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
