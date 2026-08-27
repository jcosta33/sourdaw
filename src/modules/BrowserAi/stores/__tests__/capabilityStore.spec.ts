import { afterEach, describe, expect, it } from 'vitest';

import {
    capabilityStore,
    isWebGpuAvailable,
    setCapabilityDetecting,
    setCapabilityError,
    setCapabilityReport,
} from '../capabilityStore';

import type { CapabilityReport } from '../../models/CapabilityReport';

function createCapabilityReport(webGpu: CapabilityReport['webGpu'] = { status: 'supported' }): CapabilityReport {
    return {
        capability: 'supported',
        webGpu,
        webGpuTier: 'webgpu-fast',
        crossOriginIsolated: true,
        workerAvailable: true,
        opfsAvailable: true,
        inference: {
            status: 'measured',
            modelId: 'kokoro-82m-q8',
            executionProviders: ['webgpu', 'wasm'],
            audioSeconds: 4,
            elapsedSeconds: 2,
            realtimeFactor: 2,
        },
        detectedAt: 0,
    };
}

describe('capabilityStore', () => {
    afterEach(() => {
        capabilityStore.set({ phase: 'idle' });
    });

    it('starts in idle phase', () => {
        expect(capabilityStore.value?.phase).toBe('idle');
    });

    it('setCapabilityDetecting transitions to detecting phase', () => {
        setCapabilityDetecting();

        expect(capabilityStore.value?.phase).toBe('detecting');
    });

    it('setCapabilityReport transitions to done phase with the report', () => {
        const report = createCapabilityReport();

        setCapabilityReport(report);

        const state = capabilityStore.value;
        expect(state?.phase).toBe('done');
        if (state?.phase === 'done') {
            expect(state.report).toBe(report);
        }
    });

    it('setCapabilityError transitions to error phase with a message', () => {
        setCapabilityError('WebGPU not available');

        const state = capabilityStore.value;
        expect(state?.phase).toBe('error');
        if (state?.phase === 'error') {
            expect(state.message).toBe('WebGPU not available');
        }
    });

    it('admits WebGPU only after a completed supported probe', () => {
        expect(isWebGpuAvailable()).toBe(false);

        setCapabilityDetecting();
        expect(isWebGpuAvailable()).toBe(false);

        setCapabilityError('WebGPU probe failed');
        expect(isWebGpuAvailable()).toBe(false);

        setCapabilityReport(createCapabilityReport({ status: 'unavailable', reason: 'adapter-unavailable' }));
        expect(isWebGpuAvailable()).toBe(false);

        setCapabilityReport(createCapabilityReport());
        expect(isWebGpuAvailable()).toBe(true);
    });

    it('transitions detect → done → error cycle correctly', () => {
        setCapabilityDetecting();
        expect(capabilityStore.value?.phase).toBe('detecting');

        setCapabilityReport(createCapabilityReport());
        expect(capabilityStore.value?.phase).toBe('done');

        setCapabilityError('late failure');
        const state = capabilityStore.value;
        expect(state?.phase).toBe('error');
        if (state?.phase === 'error') {
            expect(state.message).toBe('late failure');
        }
    });
});
