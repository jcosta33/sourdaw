import { describe, it, expect, vi, beforeEach } from 'vitest';

const destroyCrumbsInstance = vi.hoisted(() =>
    vi.fn<typeof import('../../../repositories/crumbsBridge/destroyCrumbsInstance').destroyCrumbsInstance>(() =>
        Promise.resolve()
    )
);

vi.mock('../../../repositories/crumbsBridge/destroyCrumbsInstance', () => ({
    destroyCrumbsInstance,
}));

import { teardownCrumbsEngine } from '../teardownCrumbsEngine';

describe('teardownCrumbsEngine', () => {
    beforeEach(() => {
        destroyCrumbsInstance.mockClear();
    });

    it('destroys the bridge instance it was asked to tear down', async () => {
        await teardownCrumbsEngine('inst-A');

        expect(destroyCrumbsInstance).toHaveBeenCalledTimes(1);
        expect(destroyCrumbsInstance).toHaveBeenCalledWith('inst-A');
    });
});
