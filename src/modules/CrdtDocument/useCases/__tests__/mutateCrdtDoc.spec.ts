import { describe, it, expect, vi, beforeEach } from 'vitest';
import { automergeRepository } from '../../repositories/automergeRepository';
import { mutateCrdtDoc } from '../mutateCrdtDoc';

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        changeDoc: vi.fn(),
    },
}));

describe('mutateCrdtDoc', () => {
    beforeEach(() => {
        vi.mocked(automergeRepository.changeDoc).mockClear();
    });

    it('should delegate the change function to the repository changeDoc', () => {
        const changeFn = vi.fn();

        mutateCrdtDoc({ id: 'root', changeFn });

        expect(automergeRepository.changeDoc).toHaveBeenCalledTimes(1);
        expect(automergeRepository.changeDoc).toHaveBeenCalledWith('root', changeFn, undefined);
    });

    it('forwards the optional change message to the repository', () => {
        const changeFn = vi.fn();

        mutateCrdtDoc({ id: 'root', changeFn, message: 'edited clip name' });

        expect(automergeRepository.changeDoc).toHaveBeenCalledWith('root', changeFn, 'edited clip name');
    });
});
