import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    dawDspEvaluated: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/wasm/daw_dsp.js', () => {
    mocks.dawDspEvaluated();
    throw new Error('daw_dsp.js evaluated');
});

describe('rejectIdentityTransitionOnBootstrapFailure', () => {
    beforeEach(() => {
        vi.resetModules();
        mocks.dawDspEvaluated.mockClear();
    });

    it('evaluates after daw_dsp has failed without evaluating daw_dsp.js', async () => {
        const { rejectIdentityTransitionOnBootstrapFailure } =
            await import('../rejectIdentityTransitionOnBootstrapFailure');
        const { whenProjectIdentityTransitionDependenciesConfigured } = await import('#/modules/Project/useCases');

        expect(mocks.dawDspEvaluated).not.toHaveBeenCalled();

        const failure = new Error('bootstrap chunk failed');
        rejectIdentityTransitionOnBootstrapFailure(failure);

        await expect(whenProjectIdentityTransitionDependenciesConfigured()).rejects.toBe(failure);
    }, 20_000);
});
