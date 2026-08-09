import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiActionHistoryStore, toggleAiHistoryPanel } from '../aiActionHistoryStore';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

/**
 * `panelOpen` is a navigation control. A refused `localStorage` write used to
 * throw out of the click handler, so on a sealed origin the AI history panel
 * became unopenable — a persistence failure taking out a piece of navigation.
 * See #1557.
 */
function blockEveryDurableWrite(): void {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
}

describe('toggleAiHistoryPanel when localStorage refuses the write', () => {
    beforeEach(() => {
        window.localStorage.clear();
        const state = aiActionHistoryStore.value;
        if (state) {
            aiActionHistoryStore.trySet({ ...state, panelOpen: false });
        }
    });

    afterEach(() => {
        vi.restoreAllMocks();
        window.localStorage.clear();
    });

    it('still opens the panel', () => {
        blockEveryDurableWrite();

        expect(() => {
            toggleAiHistoryPanel();
        }).not.toThrow();

        expect(aiActionHistoryStore.value?.panelOpen).toBe(true);
    });

    it('still closes it again', () => {
        toggleAiHistoryPanel();
        blockEveryDurableWrite();

        toggleAiHistoryPanel();

        expect(aiActionHistoryStore.value?.panelOpen).toBe(false);
    });
});
