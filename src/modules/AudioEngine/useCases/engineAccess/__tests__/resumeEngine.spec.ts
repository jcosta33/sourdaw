import { describe, it, expect, vi, beforeEach } from 'vitest';

import { resumeEngine } from '../resumeEngine';

const mocks = vi.hoisted(() => ({
    engineResume: vi.fn<() => Promise<void>>(),
}));

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        resume: mocks.engineResume,
    },
}));

describe('resumeEngine', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should call the engine resume once and return its promise', async () => {
        const pending = Promise.resolve();
        mocks.engineResume.mockReturnValue(pending);

        const returned = resumeEngine();

        expect(mocks.engineResume).toHaveBeenCalledTimes(1);
        expect(returned).toBe(pending);
        await expect(returned).resolves.toBeUndefined();
    });

    it('should reject when the engine resume rejects', async () => {
        const failure = new Error('context refused to resume');
        mocks.engineResume.mockReturnValue(Promise.reject(failure));

        await expect(resumeEngine()).rejects.toBe(failure);
    });
});
