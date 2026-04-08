import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { getNextClipId } from './getNextClipId';

describe('getNextClipId', () => {
    it('should return next id from counter', () => {
        const allocateClipIdFromCounter = vi.fn(() => 'clip-next-1');
        injectDependencies(getNextClipId, { allocateClipIdFromCounter });

        expect(getNextClipId()).toBe('clip-next-1');
        expect(allocateClipIdFromCounter).toHaveBeenCalledTimes(1);
    });
});
