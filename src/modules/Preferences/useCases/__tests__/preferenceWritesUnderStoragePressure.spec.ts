import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { preferencesStore } from '../../stores/preferencesStore';
import { updatePreferences } from '../updatePreferences';

const notifyUserMock = vi.hoisted(() =>
    vi.fn<(message: string, level?: 'info' | 'success' | 'warning' | 'error') => void>()
);
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: notifyUserMock }));

/**
 * The storage-full notice is once per session, and "the session" is module
 * state inside the adapter. Cases that assert on the notice therefore need a
 * fresh module graph, the same way a real boot gets one — sharing it would make
 * them order-dependent and let one pass because an earlier case had already
 * burned the notice. Cases that only assert on the write path use the static
 * import; re-executing this graph costs seconds and buys them nothing.
 */
async function loadPreferences(): Promise<{
    updatePreferences: typeof import('../updatePreferences').updatePreferences;
    readAutoSave: () => boolean | undefined;
}> {
    vi.resetModules();
    const store = await import('../../stores/preferencesStore');
    const useCase = await import('../updatePreferences');
    return {
        updatePreferences: useCase.updatePreferences,
        readAutoSave: () => store.preferencesStore.value?.autoSave,
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

    // Uses the statically imported module: this case is about the write path,
    // not the once-per-session notice, so it does not need a fresh graph.
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
        const { updatePreferences } = await loadPreferences();
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
        const { updatePreferences } = await loadPreferences();
        updatePreferences({ patch: { autoSave: false } });
        blockEveryDurableWrite();

        updatePreferences({ patch: { autoSave: true } });
        updatePreferences({ patch: { trackHeight: 'large' } });
        updatePreferences({ patch: { autoSave: false } });

        expect(notifyUserMock).toHaveBeenCalledTimes(1);
    });

    it('says nothing while writes are landing', () => {
        updatePreferences({ patch: { autoSave: true } });

        expect(notifyUserMock).not.toHaveBeenCalled();
        expect(preferencesStore.value?.autoSave).toBe(true);
    });
});
