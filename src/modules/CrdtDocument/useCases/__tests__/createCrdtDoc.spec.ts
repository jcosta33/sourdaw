import { describe, it, expect, vi } from 'vitest';

import { createCrdtDoc } from '../createCrdtDoc';

const mocks = vi.hoisted(() => ({
    createChildDoc: vi.fn<typeof import('../../repositories/automergeRepository').automergeRepository.createChildDoc>(),
}));

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        createChildDoc: mocks.createChildDoc,
    },
}));

describe('createCrdtDoc', () => {
    it('delegates to automergeRepository', () => {
        createCrdtDoc('child-1');
        expect(mocks.createChildDoc).toHaveBeenCalledWith('child-1');
    });
});
