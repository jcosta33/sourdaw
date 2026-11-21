import { describe, it, expect, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { resumeEngine } from '../resumeEngine';

import type { AudioEngine } from '../../../models/AudioEngineState';

describe('resumeEngine', () => {
    it('should call the engine resume once and return its promise', async () => {
        const pending = Promise.resolve();
        const engineResume = vi.fn<AudioEngine['resume']>(() => pending);
        const engine: Pick<AudioEngine, 'resume'> = { resume: engineResume };
        const run = injectDependencies(resumeEngine, { audioEngine: engine });

        const returned = run();

        expect(engineResume).toHaveBeenCalledTimes(1);
        expect(returned).toBe(pending);
        await expect(returned).resolves.toBeUndefined();
    });

    it('should reject when the engine resume rejects', async () => {
        const failure = new Error('context refused to resume');
        const engine: Pick<AudioEngine, 'resume'> = {
            resume: vi.fn<AudioEngine['resume']>(() => Promise.reject(failure)),
        };
        const run = injectDependencies(resumeEngine, { audioEngine: engine });

        await expect(run()).rejects.toBe(failure);
    });
});
