import { describe, it, expect, vi, beforeEach } from 'vitest';

const createCrumbsInstance = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('../../../repositories/crumbsBridge/createCrumbsInstance', () => ({
    createCrumbsInstance,
}));

import { crumbsStore } from '../../../stores/crumbsStore';
import { padStore } from '../../../stores/padStore';
import { sliceStore } from '../../../stores/sliceStore';
import { initCrumbsEngine } from '../initCrumbsEngine';

const INSTANCE = 'inst-A';

describe('initCrumbsEngine', () => {
    beforeEach(() => {
        createCrumbsInstance.mockReset();
        crumbsStore.set({});
        padStore.set({});
        sliceStore.set({});
    });

    it('leaves the per-instance stores populated on a successful init', async () => {
        createCrumbsInstance.mockResolvedValueOnce(undefined);

        await initCrumbsEngine(INSTANCE);

        expect(crumbsStore.value?.[INSTANCE]).toBeDefined();
        expect(padStore.value?.[INSTANCE]).toBeDefined();
        expect(sliceStore.value?.[INSTANCE]).toBeDefined();
    });

    it('rolls back the ensured stores and rethrows when the backend create rejects', async () => {
        createCrumbsInstance.mockRejectedValueOnce(new Error('backend down'));

        await expect(initCrumbsEngine(INSTANCE)).rejects.toThrow('backend down');

        // The stores must not retain a populated-but-dead instance whose param
        // writes would silently no-op against a non-existent backend.
        expect(crumbsStore.value?.[INSTANCE]).toBeUndefined();
        expect(padStore.value?.[INSTANCE]).toBeUndefined();
        expect(sliceStore.value?.[INSTANCE]).toBeUndefined();
    });
});
