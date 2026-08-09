import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { shortcutStore } from '../../stores/shortcutStore';
import { setShortcutMapping } from '../setShortcutMapping';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

/**
 * A remap used to throw out of the handler on a sealed origin, so the binding
 * the user had just assigned did nothing at all — worse than not persisting.
 * See #1557.
 */
function blockEveryDurableWrite(): void {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
}

describe('setShortcutMapping when localStorage refuses the write', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        window.localStorage.clear();
    });

    it('takes the new binding for the session instead of discarding the remap', () => {
        const definitionId = shortcutStore.value?.definitions[0]?.id;
        if (!definitionId) {
            throw new Error('Expected at least one shortcut definition to remap');
        }
        blockEveryDurableWrite();

        expect(() => {
            setShortcutMapping(definitionId, 'Ctrl+Alt+9');
        }).not.toThrow();

        expect(shortcutStore.value?.customMappings[definitionId]).toEqual(['Ctrl+Alt+9']);
    });
});
