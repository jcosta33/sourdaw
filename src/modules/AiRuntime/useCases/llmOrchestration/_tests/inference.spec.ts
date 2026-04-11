import { describe, it, expect, vi } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { generateToolCalls } from '../inference';
import { type Logger } from '#/helpers/Logger/Logger';

vi.mock('../backendResolution/getBackendChain', () => ({
    getBackendChain: vi.fn(() => []),
}));

describe('generateToolCalls', () => {
    it('should throw when no backend chain is available', async () => {
        const logger = createMock<Logger>();
        injectDependencies(generateToolCalls, { logger });

        await expect(generateToolCalls('sys', 'hello')).rejects.toThrow(/No AI backend available/);
    });
});
