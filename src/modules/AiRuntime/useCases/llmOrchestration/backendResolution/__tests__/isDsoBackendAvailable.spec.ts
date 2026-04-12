import { describe, it, expect, vi } from 'vitest';
import { isDsoBackendAvailable } from '../isDsoBackendAvailable';

const mocks = vi.hoisted(() => ({
    resolveBackend: vi.fn(),
}));

vi.mock('../helpers', () => ({
    resolveBackend: mocks.resolveBackend,
}));

describe('isDsoBackendAvailable', () => {
    it('returns true if backend is native', () => {
        mocks.resolveBackend.mockReturnValue('native');
        expect(isDsoBackendAvailable()).toBe(true);
    });

    it('returns true if backend is webllm', () => {
        mocks.resolveBackend.mockReturnValue('webllm');
        expect(isDsoBackendAvailable()).toBe(true);
    });

    it('returns false if backend is cloud', () => {
        mocks.resolveBackend.mockReturnValue('cloud');
        expect(isDsoBackendAvailable()).toBe(false);
    });

    it('returns false if backend is none', () => {
        mocks.resolveBackend.mockReturnValue('none');
        expect(isDsoBackendAvailable()).toBe(false);
    });
});
