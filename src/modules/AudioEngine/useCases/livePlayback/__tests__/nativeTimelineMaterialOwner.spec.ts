import { describe, expect, it, vi } from 'vitest';

import { nativeTimelineMaterialLeases } from '../../../repositories/nativeGraph/nativeTimelineMaterialLeases';
import { nativeTimelineMaterialOwner } from '../nativeTimelineMaterialOwner';

describe('nativeTimelineMaterialOwner', () => {
    it('retires the captured owner and immediately separates a successor generation', async () => {
        const owner = nativeTimelineMaterialLeases.captureOwner();
        const retirement = nativeTimelineMaterialOwner();
        expect(nativeTimelineMaterialLeases.captureOwner()).not.toBe(owner);
        await retirement;
    });

    it('preserves a native retirement refusal as a rejected completion', async () => {
        vi.spyOn(nativeTimelineMaterialLeases, 'retire').mockRejectedValueOnce(new Error('last reader did not settle'));
        await expect(nativeTimelineMaterialOwner()).rejects.toThrow('last reader did not settle');
        vi.restoreAllMocks();
    });
});
