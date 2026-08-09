import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const notifyUserMock = vi.hoisted(() =>
    vi.fn<(message: string, level?: 'info' | 'success' | 'warning' | 'error') => void>()
);
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: notifyUserMock }));

type Decoded = { count: number };

const decode = (value: unknown): Decoded | null => {
    if (value !== null && typeof value === 'object' && 'count' in value && typeof value.count === 'number') {
        return { count: value.count };
    }
    return null;
};

/**
 * The legacy plain-JSON adapter logged a refused write and said nothing to the
 * user, so a refused export-settings write was silent even on a healthy boot.
 * Same origin, same quota, same notice — the key is not what makes it
 * reportable. See #1557.
 */
async function loadPlainJsonStorage(): Promise<{
    create: typeof import('../createPlainJsonLocalStorage').createPlainJsonLocalStorage;
}> {
    vi.resetModules();
    const notice = await import('../storageFullNotice');
    notice.flushDeferredStorageNotice();
    const adapter = await import('../createPlainJsonLocalStorage');
    return { create: adapter.createPlainJsonLocalStorage };
}

describe('createPlainJsonLocalStorage under storage pressure', () => {
    beforeEach(() => {
        notifyUserMock.mockClear();
        window.localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        window.localStorage.clear();
    });

    it('reports the full origin to the user, not just to the log', async () => {
        const { create } = await loadPlainJsonStorage();
        const storage = create<Decoded>({ key: 'sourdaw-export-settings', decode });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        });

        expect(storage.trySet?.({ count: 3 })).toBe(false);

        expect(notifyUserMock).toHaveBeenCalledTimes(1);
        expect(notifyUserMock.mock.calls[0]?.[0]).toContain('Storage is full');
    });

    it('says nothing when the write lands', async () => {
        const { create } = await loadPlainJsonStorage();
        const storage = create<Decoded>({ key: 'sourdaw-export-settings', decode });

        expect(storage.trySet?.({ count: 3 })).toBe(true);

        expect(notifyUserMock).not.toHaveBeenCalled();
    });
});
