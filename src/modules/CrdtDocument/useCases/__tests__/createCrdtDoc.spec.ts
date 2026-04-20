import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createCrdtDoc } from '../createCrdtDoc';

const mocks = vi.hoisted(() => ({
    createChildDoc: vi.fn(),
}));

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        createChildDoc: mocks.createChildDoc,
    },
}));

describe('createCrdtDoc', () => {
    it('delegates to automergeRepository', () => {
        createCrdtDoc('child-1' as any);
        expect(mocks.createChildDoc).toHaveBeenCalledWith('child-1');
    });
});
