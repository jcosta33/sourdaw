import { afterEach, describe, expect, it } from 'vitest';

import {
    capabilityStore,
    beginCapabilityDetection,
    isWebGpuAvailable,
    settleCapabilityError,
    settleCapabilityReport,
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

    it('begins capability detection in the detecting phase', () => {
        beginCapabilityDetection();

        expect(capabilityStore.value?.phase).toBe('detecting');
    });

    it('settles the current detection attempt with its report', () => {
        const report = createCapabilityReport();

        const attempt = beginCapabilityDetection();
        settleCapabilityReport(attempt, report);

        const state = capabilityStore.value;
        expect(state?.phase).toBe('done');
        if (state?.phase === 'done') {
            expect(state.report).toBe(report);
        }
    });

    it('settles the current detection attempt with its error', () => {
        const attempt = beginCapabilityDetection();
        settleCapabilityError(attempt, 'WebGPU not available');

        const state = capabilityStore.value;
        expect(state?.phase).toBe('error');
        if (state?.phase === 'error') {
            expect(state.message).toBe('WebGPU not available');
        }
    });

    it('admits WebGPU only after a completed supported probe', () => {
        expect(isWebGpuAvailable()).toBe(false);

        const detectingAttempt = beginCapabilityDetection();
        expect(isWebGpuAvailable()).toBe(false);

        settleCapabilityError(detectingAttempt, 'WebGPU probe failed');
        expect(isWebGpuAvailable()).toBe(false);

        const unavailableAttempt = beginCapabilityDetection();
        settleCapabilityReport(
            unavailableAttempt,
            createCapabilityReport({ status: 'unavailable', reason: 'adapter-unavailable' })
        );
        expect(isWebGpuAvailable()).toBe(false);

        const supportedAttempt = beginCapabilityDetection();
        settleCapabilityReport(supportedAttempt, createCapabilityReport());
        expect(isWebGpuAvailable()).toBe(true);
    });

    it('transitions detect → done → error cycle correctly', () => {
        const supportedAttempt = beginCapabilityDetection();
        expect(capabilityStore.value?.phase).toBe('detecting');

        settleCapabilityReport(supportedAttempt, createCapabilityReport());
        expect(capabilityStore.value?.phase).toBe('done');

        const failedAttempt = beginCapabilityDetection();
        settleCapabilityError(failedAttempt, 'late failure');
        const state = capabilityStore.value;
        expect(state?.phase).toBe('error');
        if (state?.phase === 'error') {
            expect(state.message).toBe('late failure');
        }
    });

    it('ignores a late report from an older probe after a newer probe fails', () => {
        const olderAttempt = beginCapabilityDetection();
        const newerAttempt = beginCapabilityDetection();

        settleCapabilityError(newerAttempt, 'adapter unavailable');
        settleCapabilityReport(olderAttempt, createCapabilityReport());

        expect(capabilityStore.value).toEqual({ phase: 'error', message: 'adapter unavailable' });
        expect(isWebGpuAvailable()).toBe(false);
    });
});
