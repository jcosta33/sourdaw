import { describe, it, expect, vi, beforeEach } from 'vitest';

import { automergeRepository } from '../../repositories/automergeRepository';
import { replaceCrdtDoc } from '../replaceCrdtDoc';

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        replaceDoc: vi.fn(),
    },
}));

describe('replaceCrdtDoc', () => {
    beforeEach(() => {
        vi.mocked(automergeRepository.replaceDoc).mockReset();
    });

    it('should delegate id and doc to the repository replaceDoc', () => {
        const doc = { _state: {} } as any;

        replaceCrdtDoc({ id: 'root', doc });

        expect(automergeRepository.replaceDoc).toHaveBeenCalledTimes(1);
        expect(automergeRepository.replaceDoc).toHaveBeenCalledWith('root', doc);
    });
});
