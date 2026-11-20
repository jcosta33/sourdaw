import { describe, expect, it } from 'vitest';

import { pendingKeyedUnloads } from '../pendingKeyedUnloads';

describe('pendingKeyedUnloads', () => {
    it('keeps a later unload pending when an earlier unload of the same instance settles', async () => {
        const earlier = Promise.withResolvers<void>();
        const later = Promise.withResolvers<void>();
        pendingKeyedUnloads.track('overlap', earlier.promise);
        pendingKeyedUnloads.track('overlap', later.promise);

        earlier.resolve();
        await earlier.promise;

        expect(pendingKeyedUnloads.get('overlap')).toBe(later.promise);
        later.resolve();
        await later.promise;
        expect(pendingKeyedUnloads.get('overlap')).toBeUndefined();
    });

    it('advances the generation once per admitted unload', () => {
        const before = pendingKeyedUnloads.generation('counted');
        pendingKeyedUnloads.track('counted', Promise.resolve());
        pendingKeyedUnloads.track('counted', Promise.resolve());

        expect(pendingKeyedUnloads.generation('counted')).toBe(before + 2);
    });
});
