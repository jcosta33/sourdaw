import { describe, it, expect, vi, beforeEach } from 'vitest';

import { automergeRepository } from '../../repositories/automergeRepository';
import { removeCrdtDoc } from '../removeCrdtDoc';

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        removeDoc: vi.fn(),
    },
}));

describe('removeCrdtDoc', () => {
    beforeEach(() => {
        vi.mocked(automergeRepository.removeDoc).mockClear();
    });

    it('should delegate to the repository removeDoc', () => {
        removeCrdtDoc('child-doc');

        expect(automergeRepository.removeDoc).toHaveBeenCalledTimes(1);
        expect(automergeRepository.removeDoc).toHaveBeenCalledWith('child-doc');
    });
});
