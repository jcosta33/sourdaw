import { describe, it, expect, vi } from 'vitest';

import { saveSnapshot } from '../saveSnapshot';

const mocks = vi.hoisted(() => ({
    saveAll: vi.fn(),
}));

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        saveAll: mocks.saveAll,
    },
}));

describe('saveSnapshot', () => {
    it('should delegate to automergeRepository.saveAll', () => {
        const bundle = new Map();
        mocks.saveAll.mockReturnValue(bundle);

        expect(saveSnapshot()).toBe(bundle);
        expect(mocks.saveAll).toHaveBeenCalledTimes(1);
    });
});
