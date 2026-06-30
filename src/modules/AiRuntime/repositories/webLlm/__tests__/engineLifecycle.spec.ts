import { describe, it, expect, vi, beforeEach } from 'vitest';

import { initWebLlmEngine } from '../initWebLlmEngine';
import { unloadWebLlmEngine } from '../unloadWebLlmEngine';

const { mockLogger } = vi.hoisted(() => ({
    mockLogger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));
vi.mock('#/infra/logger/appLogger', () => ({ logger: mockLogger }));

describe('WebLLM engineLifecycle injectables', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should reject init when WebGPU is unavailable', async () => {
        await expect(initWebLlmEngine()).rejects.toThrow(/WebGPU not available/);
    });

    it('should unload engine and log', () => {
        unloadWebLlmEngine();
        expect(mockLogger.info).toHaveBeenCalledWith('[AI Engine] WebLLM unloaded from memory');
    });
});
