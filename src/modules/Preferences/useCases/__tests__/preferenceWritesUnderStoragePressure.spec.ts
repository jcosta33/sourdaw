import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { preferencesStore } from '../../stores/preferencesStore';
import { updatePreferences } from '../updatePreferences';

const notifyUserMock = vi.hoisted(() =>
    vi.fn<(message: string, level?: 'info' | 'success' | 'warning' | 'error') => void>()
);
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: notifyUserMock }));

/**
 * The storage-full notice is once per session, and "the session" is module state
 * inside `storageFullNotice.ts`. Every case that touches the notice — including
 * the negative controls — gets its own module graph, the way a real boot does.
 *
 * This is not defensive tidiness. An earlier version of this file ran its first
 * case against the static import, and that case spent the once-per-session flag
 * before any other case ran: the negative control then passed because the notice
 * was already used up, not because nothing fired it. Adding
 * `reportStorageFullOnce()` to the *success* path of `trySet` left all four
 * green.
 *
 * `booted: true` models a running app: the composition root has registered the
 * notification bus and called `flushDeferredStorageNotice`. `booted: false`
 * models module-evaluation time, before the root exists.
 */
async function loadPreferences({ booted }: { booted: boolean }): Promise<{
    updatePreferences: typeof import('../updatePreferences').updatePreferences;
    readAutoSave: () => boolean | undefined;
    flushDeferredStorageNotice: () => void;
}> {
    vi.resetModules();
    const store = await import('../../stores/preferencesStore');
    const useCase = await import('../updatePreferences');
    const notice = await import('#/infra/store/storage/storageFullNotice');
    if (booted) {
        notice.flushDeferredStorageNotice();
    }
    return {
        updatePreferences: useCase.updatePreferences,
        readAutoSave: () => store.preferencesStore.value?.autoSave,
        flushDeferredStorageNotice: notice.flushDeferredStorageNotice,
    };
}

/**
 * A refused preference write used to throw out of the click handler.
 *
 * `createStore.set` calls `storage.set` directly — only the constructor seed and
 * `trySet` route through the guarded path — so on a sealed origin these writes
 * were not "applied but not persisted". They threw, synchronously, from a React
 * event handler, and `registerGlobalErrorHandlers` only listens for
 * `unhandledrejection`, so nothing caught them and the interaction was
 * discarded outright. `autoSave` could not be switched on even for the current
 * session, and the user was told nothing. See #1557.
 */
function blockEveryDurableWrite(): void {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
}

describe('preference writes when localStorage refuses the write', () => {
    beforeEach(() => {
        notifyUserMock.mockClear();
        window.localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        window.localStorage.clear();
    });

    // The one case that is purely about the write path. It uses the static
    // import deliberately and asserts nothing about the notice, so it cannot
    // certify anything for the cases below.
    it('applies the change to the running session instead of discarding the interaction', () => {
        updatePreferences({ patch: { autoSave: false } });
        blockEveryDurableWrite();

        expect(() => {
            updatePreferences({ patch: { autoSave: true } });
        }).not.toThrow();

        // The whole point: the user asked for autosave and gets autosave for
        // this session, even though it will not survive a reload.
        expect(preferencesStore.value?.autoSave).toBe(true);
    });

    it('tells the user their changes are not being saved, naming the cause and an action', async () => {
        const { updatePreferences } = await loadPreferences({ booted: true });
        updatePreferences({ patch: { autoSave: false } });
        blockEveryDurableWrite();

        updatePreferences({ patch: { autoSave: true } });

        expect(notifyUserMock).toHaveBeenCalledTimes(1);
        const [message, level] = notifyUserMock.mock.calls[0] ?? [];
        expect(message).toContain('Storage is full');
        expect(message).toContain('Free up space');
        expect(level).toBe('error');
    });

    it('says it once per session, not once per write', async () => {
        const { updatePreferences } = await loadPreferences({ booted: true });
        updatePreferences({ patch: { autoSave: false } });
        blockEveryDurableWrite();

        updatePreferences({ patch: { autoSave: true } });
        updatePreferences({ patch: { trackHeight: 'large' } });
        updatePreferences({ patch: { autoSave: false } });

        expect(notifyUserMock).toHaveBeenCalledTimes(1);
    });

    // The discriminator, in a graph that has never seen a refusal. Without it,
    // `reportStorageFullOnce()` on the *success* path of `trySet` goes
    // undetected — which is exactly how this file passed before.
    it('says nothing while writes are landing', async () => {
        const { updatePreferences, readAutoSave } = await loadPreferences({ booted: true });

        updatePreferences({ patch: { autoSave: true } });
        updatePreferences({ patch: { trackHeight: 'large' } });

        expect(notifyUserMock).not.toHaveBeenCalled();
        expect(readAutoSave()).toBe(true);
    });

    /**
     * The pre-bootstrap path, which is the whole reason the notice is held
     * rather than sent. `notifyUser` is DI-injected and `inject` caches the
     * closure it builds on first call; an unregistered `NotificationEventBus`
     * token resolves to the abstract class instead of throwing, so one
     * pre-bootstrap call would cache a bus with no `emit` and break every
     * `notifyUser` site for the life of the page. A store's constructor seed is
     * such a caller on a sealed origin.
     */
    describe('a refusal before the composition root exists', () => {
        it('holds the notice rather than resolving the notification bus', async () => {
            const { updatePreferences } = await loadPreferences({ booted: false });
            updatePreferences({ patch: { autoSave: false } });
            blockEveryDurableWrite();

            updatePreferences({ patch: { autoSave: true } });

            expect(notifyUserMock).not.toHaveBeenCalled();
        });

        it('delivers it once the composition root flushes', async () => {
            const { updatePreferences, flushDeferredStorageNotice } = await loadPreferences({ booted: false });
            updatePreferences({ patch: { autoSave: false } });
            blockEveryDurableWrite();
            updatePreferences({ patch: { autoSave: true } });

            flushDeferredStorageNotice();

            expect(notifyUserMock).toHaveBeenCalledTimes(1);
            expect(notifyUserMock.mock.calls[0]?.[0]).toContain('Storage is full');
        });

        it('does not spend the notice on a deferral that never reached the user', async () => {
            // The flag must track delivery, not intent. Burning it on a held
            // notice would leave every later refusal — on a working bus —
            // permanently silent.
            const { updatePreferences, flushDeferredStorageNotice } = await loadPreferences({ booted: false });
            updatePreferences({ patch: { autoSave: false } });
            blockEveryDurableWrite();
            updatePreferences({ patch: { autoSave: true } });

            flushDeferredStorageNotice();
            expect(notifyUserMock).toHaveBeenCalledTimes(1);

            // ...and a later refusal in the same session does not re-notify.
            updatePreferences({ patch: { trackHeight: 'large' } });
            expect(notifyUserMock).toHaveBeenCalledTimes(1);
        });
    });
});
