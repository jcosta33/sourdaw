import { describe, expect, it } from 'vitest';

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
});
