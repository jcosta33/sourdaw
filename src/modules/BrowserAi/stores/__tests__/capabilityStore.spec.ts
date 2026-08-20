import { afterEach, describe, expect, it } from 'vitest';

import { capabilityStore, setCapabilityDetecting, setCapabilityError, setCapabilityReport } from '../capabilityStore';

import type { CapabilityReport } from '../../models/CapabilityReport';

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
        const report = {
            capability: 'supported',
            webGpu: { status: 'supported' },
            webGpuTier: 'webgpu-fast',
            sharedArrayBuffer: true,
            opfsAvailable: true,
            chromeVersion: 120,
            inference: {
                status: 'measured',
                modelId: 'kokoro-82m-q8',
                executionProviders: ['webgpu', 'wasm'],
                audioSeconds: 4,
                elapsedSeconds: 2,
                realtimeFactor: 2,
            },
            detectedAt: Date.now(),
        } as CapabilityReport;

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

    it('transitions detect → done → error cycle correctly', () => {
        setCapabilityDetecting();
        expect(capabilityStore.value?.phase).toBe('detecting');

        setCapabilityReport({} as CapabilityReport);
        expect(capabilityStore.value?.phase).toBe('done');

        setCapabilityError('late failure');
        const state = capabilityStore.value;
        expect(state?.phase).toBe('error');
        if (state?.phase === 'error') {
            expect(state.message).toBe('late failure');
        }
    });
});
