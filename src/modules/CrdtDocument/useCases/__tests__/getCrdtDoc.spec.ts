import { describe, it, expect, vi } from 'vitest';

import { getCrdtDoc } from '../getCrdtDoc';

const mocks = vi.hoisted(() => ({
    getDoc: vi.fn<typeof import('../../repositories/automergeRepository').automergeRepository.getDoc>(),
}));

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        getDoc: mocks.getDoc,
    },
}));

describe('getCrdtDoc', () => {
    it('delegates to automergeRepository', () => {
        mocks.getDoc.mockReturnValue({ some: 'data' });
        const result = getCrdtDoc('doc-1');
        expect(mocks.getDoc).toHaveBeenCalledWith('doc-1');
        expect(result).toEqual({ some: 'data' });
    });
});
