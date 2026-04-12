import { describe, it, expect, vi, beforeEach } from 'vitest';
import { automergeRepository } from '../../repositories/automergeRepository';
import { hasCrdtDoc } from '../hasCrdtDoc';

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        hasDoc: vi.fn(),
    },
}));

describe('hasCrdtDoc', () => {
    beforeEach(() => {
        vi.mocked(automergeRepository.hasDoc).mockReset();
    });

    it('should return true when the repository has the document', () => {
        vi.mocked(automergeRepository.hasDoc).mockReturnValue(true);

        expect(hasCrdtDoc('root')).toBe(true);
        expect(automergeRepository.hasDoc).toHaveBeenCalledWith('root');
    });

    it('should return false when the repository does not have the document', () => {
        vi.mocked(automergeRepository.hasDoc).mockReturnValue(false);

        expect(hasCrdtDoc('missing-id')).toBe(false);
        expect(automergeRepository.hasDoc).toHaveBeenCalledWith('missing-id');
    });
});
