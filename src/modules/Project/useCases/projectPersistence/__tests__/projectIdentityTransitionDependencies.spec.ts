import { describe, expect, it } from 'vitest';

import { failProjectIdentityTransitionDependencies } from '../failProjectIdentityTransitionDependencies';
import { setProjectIdentityTransitionDependencies } from '../projectIdentityTransitionDependencies';
import { resetProjectIdentityTransitionDependencies } from '../resetProjectIdentityTransitionDependencies';
import { whenProjectIdentityTransitionDependenciesConfigured } from '../whenProjectIdentityTransitionDependenciesConfigured';

describe('projectIdentityTransitionDependencies', () => {
    it('stays pending until identity-transition dependencies are configured', async () => {
        resetProjectIdentityTransitionDependencies();

        let ready = false;
        void whenProjectIdentityTransitionDependenciesConfigured().then(() => {
            ready = true;
        });
        await Promise.resolve();
        expect(ready).toBe(false);

        setProjectIdentityTransitionDependencies({
            leaveCollaborationSession: () => Promise.resolve(),
        });
        await whenProjectIdentityTransitionDependenciesConfigured();
        expect(ready).toBe(true);
    });

    it('rejects waiters when identity-transition configuration fails closed', async () => {
        resetProjectIdentityTransitionDependencies();
        const failure = new Error('bootstrap chunk failed');

        failProjectIdentityTransitionDependencies(failure);

        await expect(whenProjectIdentityTransitionDependenciesConfigured()).rejects.toBe(failure);
    });
});
