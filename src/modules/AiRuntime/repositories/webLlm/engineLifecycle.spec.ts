import { describe, it, expect } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { initWebLlmEngine, unloadWebLlmEngine } from './engineLifecycle';
import { type Logger } from '#/helpers/Logger/Logger';

describe('WebLLM engineLifecycle injectables', () => {
    it('should reject init when WebGPU is unavailable', async () => {
        const logger = createMock<Logger>();
        injectDependencies(initWebLlmEngine, { logger });

        await expect(initWebLlmEngine()).rejects.toThrow(/WebGPU not available/);
    });

    it('should unload engine and log', () => {
        const logger = createMock<Logger>();
        injectDependencies(unloadWebLlmEngine, { logger });

        unloadWebLlmEngine();

        expect(logger.info).toHaveBeenCalledWith('[AI Engine] WebLLM unloaded from memory');
    });
});
