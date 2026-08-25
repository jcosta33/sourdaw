import { describe, it, expect, vi } from 'vitest';

import { type AiBackend } from '../../../../models/LlmOrchestrationTypes';
import { isLlmAvailable } from '../isLlmAvailable';

const mocks = vi.hoisted(() => ({
    resolveBackend: vi.fn<() => AiBackend>(),
}));

vi.mock('../helpers', () => ({
    resolveBackend: mocks.resolveBackend,
}));

describe('isLlmAvailable', () => {
    it('returns true if backend is anything other than none', () => {
        mocks.resolveBackend.mockReturnValue('webllm');
        expect(isLlmAvailable()).toBe(true);

        mocks.resolveBackend.mockReturnValue('cloud');
        expect(isLlmAvailable()).toBe(true);
    });

    it('returns false if backend is none', () => {
        mocks.resolveBackend.mockReturnValue('none');
        expect(isLlmAvailable()).toBe(false);
    });
});
