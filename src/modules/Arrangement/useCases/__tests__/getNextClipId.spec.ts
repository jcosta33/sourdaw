import { describe, it, expect, vi } from 'vitest';
import { getNextClipId } from '../getNextClipId';
import { getNextClipId as allocateClipIdFromCounter } from '../../repositories/clipIdCounter';

vi.mock('../../repositories/clipIdCounter', () => ({
    getNextClipId: vi.fn(),
}));

describe('getNextClipId', () => {
    it('should return next id from counter', () => {
        vi.mocked(allocateClipIdFromCounter).mockReturnValue('clip-next-1');

        expect(getNextClipId()).toBe('clip-next-1');
        expect(allocateClipIdFromCounter).toHaveBeenCalledTimes(1);
    });
});
