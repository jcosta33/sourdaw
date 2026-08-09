import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { alphaNoticeStore } from '../../stores/alphaNoticeStore';
import { dismissAlphaNotice } from '../dismissAlphaNotice';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

/**
 * Dismissing the alpha notice is a click handler, and a refused `localStorage`
 * write used to throw out of it — so on a sealed origin the notice could not be
 * dismissed at all and reappeared on every interaction. Not persisting the
 * dismissal is a small loss; not being able to close the banner is not. See
 * #1557.
 */
function blockEveryDurableWrite(): void {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
}

describe('dismissAlphaNotice when localStorage refuses the write', () => {
    beforeEach(() => {
        window.localStorage.clear();
        alphaNoticeStore.trySet(false);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        window.localStorage.clear();
    });

    it('dismisses the notice for the session instead of throwing out of the handler', () => {
        blockEveryDurableWrite();

        expect(() => {
            dismissAlphaNotice();
        }).not.toThrow();

        expect(alphaNoticeStore.value).toBe(true);
    });

    it('persists the dismissal when the write lands', () => {
        dismissAlphaNotice();

        expect(alphaNoticeStore.value).toBe(true);
        expect(window.localStorage.getItem('sourdaw-alpha-notice-dismissed')).not.toBeNull();
    });
});
