import { describe, it, expect, vi } from 'vitest';
import { executeDsoEdit } from './executeDsoEdit';

vi.mock('../llmOrchestration/backendResolution', () => ({
    resolveBackend: () => 'none' as const,
    isDsoBackendAvailable: () => false,
}));

describe('executeDsoEdit', () => {
    it('should return failure when no DSO-capable backend is available', async () => {
        const result = await executeDsoEdit('make it louder');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/DSO-capable backend/);
        expect(result.plan).toBeNull();
    });
});
