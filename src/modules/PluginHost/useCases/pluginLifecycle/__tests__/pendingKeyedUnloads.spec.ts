import { afterEach, describe, expect, it } from 'vitest';

import { loadedExternalInstances } from '../loadedExternalInstances';
import { pendingKeyedUnloadGenerations, pendingKeyedUnloads } from '../pendingKeyedUnloads';
import { scheduleKeyedUnload } from '../scheduleKeyedUnload';

const INSTANCE_ID = 'pending-unload-instance';

describe('pending keyed unloads', () => {
    afterEach(() => {
        loadedExternalInstances.delete(INSTANCE_ID);
    });

    it('keeps a later unload pending when an earlier unload of the same instance settles', async () => {
        loadedExternalInstances.add(INSTANCE_ID);
        const earlierNative = Promise.withResolvers<void>();
        const laterNative = Promise.withResolvers<void>();
        const earlier = scheduleKeyedUnload(INSTANCE_ID, () => earlierNative.promise);
        const later = scheduleKeyedUnload(INSTANCE_ID, () => laterNative.promise);

        earlierNative.resolve();
        await earlier;

        expect(pendingKeyedUnloads.get(INSTANCE_ID)).toBe(later);
        laterNative.resolve();
        await later;
        expect(pendingKeyedUnloads.has(INSTANCE_ID)).toBe(false);
    });

    it('advances the instance generation once per admitted unload', async () => {
        const before = pendingKeyedUnloadGenerations.get(INSTANCE_ID) ?? 0;

        await Promise.all([
            scheduleKeyedUnload(INSTANCE_ID, () => Promise.resolve()),
            scheduleKeyedUnload(INSTANCE_ID, () => Promise.resolve()),
        ]);

        expect(pendingKeyedUnloadGenerations.get(INSTANCE_ID)).toBe(before + 2);
    });
});
