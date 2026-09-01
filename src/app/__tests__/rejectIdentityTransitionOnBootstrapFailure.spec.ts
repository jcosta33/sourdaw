import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    audioEngineEvaluated: vi.fn(),
    projectUseCasesEvaluated: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => {
    mocks.audioEngineEvaluated();
    return {
        get analyzePitchForClip() {
            throw new Error('daw_dsp.js evaluated');
        },
    };
});

vi.mock('#/modules/Project/useCases', async () => {
    mocks.projectUseCasesEvaluated();
    const audioEngine = await import('#/modules/AudioEngine/useCases');
    Reflect.get(audioEngine, 'analyzePitchForClip');
    return {
        failProjectIdentityTransitionDependencies: vi.fn(),
        loadProject: vi.fn(),
        reportProjectLoadFailure: vi.fn(),
        saveProject: vi.fn(),
        whenProjectIdentityTransitionDependenciesConfigured: () => new Promise<void>(() => undefined),
    };
});

describe('rejectIdentityTransitionOnBootstrapFailure', () => {
    beforeEach(() => {
        vi.resetModules();
        mocks.audioEngineEvaluated.mockClear();
        mocks.projectUseCasesEvaluated.mockClear();
    });

    it('evaluates after AudioEngine has failed without loading the Project useCases barrel', async () => {
        const { rejectIdentityTransitionOnBootstrapFailure } =
            await import('../rejectIdentityTransitionOnBootstrapFailure');
        const { whenProjectIdentityTransitionDependenciesConfigured } = await import('#/modules/Project/events');

        expect(mocks.projectUseCasesEvaluated).not.toHaveBeenCalled();
        expect(mocks.audioEngineEvaluated).not.toHaveBeenCalled();

        const failure = new Error('bootstrap chunk failed');
        rejectIdentityTransitionOnBootstrapFailure(failure);

        await expect(whenProjectIdentityTransitionDependenciesConfigured()).rejects.toBe(failure);
    });
});
