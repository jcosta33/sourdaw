import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const helperSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../rejectIdentityTransitionOnBootstrapFailure.ts'),
    'utf8'
);

const mocks = vi.hoisted(() => {
    const identity = {
        ready: new Promise<void>(() => undefined),
        fail(_reason: unknown): void {
            // replaced by reset()
        },
        reset(): void {
            let rejectReady: (reason: unknown) => void = () => undefined;
            this.ready = new Promise<void>((_resolve, reject) => {
                rejectReady = reject;
            });
            void this.ready.catch(() => undefined);
            this.fail = (reason: unknown): void => {
                rejectReady(reason);
            };
        },
    };
    identity.reset();

    return {
        failIdentityTransition: vi.fn(),
        identity,
    };
});

vi.mock('#/modules/Project/useCases', () => ({
    failProjectIdentityTransitionDependencies: (reason: unknown) => {
        mocks.failIdentityTransition(reason);
        mocks.identity.fail(reason);
    },
    whenProjectIdentityTransitionDependenciesConfigured: () => mocks.identity.ready,
}));

describe('rejectIdentityTransitionOnBootstrapFailure', () => {
    beforeEach(() => {
        vi.resetModules();
        mocks.failIdentityTransition.mockClear();
        mocks.identity.reset();
    });

    it('does not statically pull daw_dsp', () => {
        expect(helperSource).not.toMatch(/daw_dsp/);
        expect(helperSource).toMatch(/from '#\/modules\/Project\/useCases'/);
    });

    it('rejects identity-transition configuration through Project/useCases', async () => {
        const { rejectIdentityTransitionOnBootstrapFailure } =
            await import('../rejectIdentityTransitionOnBootstrapFailure');
        const { whenProjectIdentityTransitionDependenciesConfigured } = await import('#/modules/Project/useCases');

        const failure = new Error('bootstrap chunk failed');
        rejectIdentityTransitionOnBootstrapFailure(failure);

        expect(mocks.failIdentityTransition).toHaveBeenCalledOnce();
        expect(mocks.failIdentityTransition).toHaveBeenCalledWith(failure);
        await expect(whenProjectIdentityTransitionDependenciesConfigured()).rejects.toBe(failure);
    });
});
