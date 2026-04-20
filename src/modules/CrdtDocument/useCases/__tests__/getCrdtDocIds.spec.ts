import { describe, it, expect, vi, beforeEach } from 'vitest';

import { automergeRepository } from '../../repositories/automergeRepository';
import { getCrdtDocIds } from '../getCrdtDocIds';

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        getDocIds: vi.fn(),
    },
}));

describe('getCrdtDocIds', () => {
    beforeEach(() => {
        vi.mocked(automergeRepository.getDocIds).mockReset();
    });

    it('should return the document id list from the repository', () => {
        const ids = ['root', 'child-1'];
        vi.mocked(automergeRepository.getDocIds).mockReturnValue(ids);

        expect(getCrdtDocIds()).toBe(ids);
        expect(automergeRepository.getDocIds).toHaveBeenCalledTimes(1);
    });
});
