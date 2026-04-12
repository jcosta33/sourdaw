import { describe, it, expect, vi, beforeEach } from 'vitest';
import { automergeRepository } from '../../repositories/automergeRepository';
import { subscribeToCrdtChanges } from '../subscribeToCrdtChanges';

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        onChange: vi.fn(),
    },
}));

describe('subscribeToCrdtChanges', () => {
    beforeEach(() => {
        vi.mocked(automergeRepository.onChange).mockReset();
    });

    it('should subscribe via the repository and return its unsubscribe function', () => {
        const listener = vi.fn();
        const unsubscribe = vi.fn();
        vi.mocked(automergeRepository.onChange).mockReturnValue(unsubscribe);

        const result = subscribeToCrdtChanges(listener);

        expect(automergeRepository.onChange).toHaveBeenCalledWith(listener);
        expect(result).toBe(unsubscribe);
    });
});
