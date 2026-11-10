import { describe, it, expect } from 'vitest';

import { router } from '../router';

describe('router', () => {
    it('does not enable scroll restoration because the workspace owns its scroll positions', () => {
        expect(router.options.scrollRestoration).not.toBeTruthy();
    });
});
