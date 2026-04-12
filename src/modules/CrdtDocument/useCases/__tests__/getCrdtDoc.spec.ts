import { describe, it, expect, vi } from 'vitest';
import { getCrdtDoc } from '../getCrdtDoc';

const mocks = vi.hoisted(() => ({
    getDoc: vi.fn(),
}));

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        getDoc: mocks.getDoc,
    }
}));

describe('getCrdtDoc', () => {
    it('delegates to automergeRepository', () => {
        mocks.getDoc.mockReturnValue({ some: 'data' });
        const result = getCrdtDoc('doc-1' as any);
        expect(mocks.getDoc).toHaveBeenCalledWith('doc-1');
        expect(result).toEqual({ some: 'data' });
    });
});
