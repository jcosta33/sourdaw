import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { type CapabilityReport } from '../../models/CapabilityReport';
import { capabilityStore } from '../../stores/capabilityStore';
import { detectCapabilities } from '../detectCapabilities';

type DetectCapabilitiesRepo = (input: {
    forceRefresh: boolean;
    measureInference: boolean;
}) => Promise<CapabilityReport>;

function createLoggerMock(): { info: (message: string) => void; error: (error: Error) => void } {
    return { info: vi.fn(), error: vi.fn() };
}

const report: CapabilityReport = {
    capability: 'supported',
    webGpu: { status: 'supported' },
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
    detectedAt: 1_800_000_000_000,
};

describe('detectCapabilities', () => {
    beforeEach(() => {
        capabilityStore.set({ phase: 'idle' });
    });

    it('reports the detected capability once the repository resolves', async () => {
        const detectCapabilitiesRepo = vi.fn<DetectCapabilitiesRepo>().mockResolvedValue(report);
        const logger = createLoggerMock();
        injectDependencies(detectCapabilities, { logger, detectCapabilitiesRepo });

        await detectCapabilities();

        expect(detectCapabilitiesRepo).toHaveBeenCalledWith({ forceRefresh: false, measureInference: false });
        expect(capabilityStore.value).toEqual({ phase: 'done', report });
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('supported / webgpu-fast'));
    });

    it('forwards forceRefresh through to the repository', async () => {
        const detectCapabilitiesRepo = vi.fn<DetectCapabilitiesRepo>().mockResolvedValue(report);
        injectDependencies(detectCapabilities, { logger: createLoggerMock(), detectCapabilitiesRepo });

        await detectCapabilities({ forceRefresh: true });

        expect(detectCapabilitiesRepo).toHaveBeenCalledWith({ forceRefresh: true, measureInference: false });
    });

    it('forwards measureInference through to the repository', async () => {
        const detectCapabilitiesRepo = vi.fn<DetectCapabilitiesRepo>().mockResolvedValue(report);
        injectDependencies(detectCapabilities, { logger: createLoggerMock(), detectCapabilitiesRepo });

        await detectCapabilities({ forceRefresh: true, measureInference: true });

        expect(detectCapabilitiesRepo).toHaveBeenCalledWith({ forceRefresh: true, measureInference: true });
    });

    it('records an error state when detection fails', async () => {
        const detectCapabilitiesRepo = vi.fn<DetectCapabilitiesRepo>().mockRejectedValue(new Error('no webgpu'));
        const logger = createLoggerMock();
        injectDependencies(detectCapabilities, { logger, detectCapabilitiesRepo });

        await detectCapabilities();

        expect(capabilityStore.value).toEqual({ phase: 'error', message: 'no webgpu' });
        expect(logger.error).toHaveBeenCalledWith(new Error('[BrowserAi] Capability detection failed: no webgpu'));
    });

    it('stringifies a non-Error rejection as the stored error message', async () => {
        const detectCapabilitiesRepo = vi.fn<DetectCapabilitiesRepo>().mockRejectedValue('webgpu-context-lost');
        const logger = createLoggerMock();
        injectDependencies(detectCapabilities, { logger, detectCapabilitiesRepo });

        await detectCapabilities();

        expect(capabilityStore.value).toEqual({ phase: 'error', message: 'webgpu-context-lost' });
    });
});
