import { describe, it, expect, vi } from 'vitest';
import { generateToolCalls } from '../inference';

vi.mock('../backendResolution/getBackendChain', () => ({
    getBackendChain: vi.fn(() => []),
}));

const { mockLogger } = vi.hoisted(() => ({
    mockLogger: {
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: mockLogger,
}));

describe('generateToolCalls', () => {
    it('should throw when no backend chain is available', async () => {
        await expect(generateToolCalls('sys', 'hello')).rejects.toThrow(/No AI backend available/);
    });
});
