import { beforeEach, describe, expect, it, vi } from 'vitest';

import { alphaNoticeStore } from '../../stores/alphaNoticeStore';
import { dismissAlphaNotice } from '../dismissAlphaNotice';

const mocks = vi.hoisted(() => ({
    alphaNoticeStoreSet: vi.fn(),
}));

vi.mock('../../stores/alphaNoticeStore', () => ({
    alphaNoticeStore: {
        trySet: mocks.alphaNoticeStoreSet,
    },
}));

describe('dismissAlphaNotice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should persist dismissal in alphaNoticeStore', () => {
        dismissAlphaNotice();

        expect(alphaNoticeStore.trySet).toHaveBeenCalledWith(true);
    });
});
