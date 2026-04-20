import { describe, it, expect, vi } from 'vitest';

import { restoreSnapshot } from '../restoreSnapshot';

const mocks = vi.hoisted(() => ({
    restoreSnapshot: vi.fn(),
}));

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        restoreSnapshot: mocks.restoreSnapshot,
    },
}));

describe('restoreSnapshot', () => {
    it('should delegate the bundle to automergeRepository.restoreSnapshot', () => {
        const bundle = new Map();

        restoreSnapshot(bundle);

        expect(mocks.restoreSnapshot).toHaveBeenCalledTimes(1);
        expect(mocks.restoreSnapshot).toHaveBeenCalledWith(bundle);
    });
});
