import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultPreferences } from '../../models/Preferences';
import { preferencesStore } from '../../stores/preferencesStore';
import { onSoloModePreferenceApplied } from '../onSoloModePreferenceApplied';
import { resetPreferences } from '../resetPreferences';

const mocks = vi.hoisted(() => ({
    preferencesStoreSet: vi.fn(),
}));

vi.mock('../../stores/preferencesStore', () => ({
    preferencesStore: {
        trySet: mocks.preferencesStoreSet,
    },
}));

describe('resetPreferences', () => {
    let unsubscribe: (() => void) | null = null;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        unsubscribe?.();
        unsubscribe = null;
    });

    it('resets the preferences store to defaults', () => {
        resetPreferences();

        expect(preferencesStore.trySet).toHaveBeenCalledWith(defaultPreferences);
    });

    it('reports every reset after the owner write even when storage refuses durability', () => {
        const order: string[] = [];
        mocks.preferencesStoreSet.mockImplementation(() => {
            order.push('write');
            return false;
        });
        unsubscribe = onSoloModePreferenceApplied(({ soloMode }) => {
            order.push(`applied:${soloMode}`);
        });

        resetPreferences();
        resetPreferences();

        expect(order).toEqual(['write', 'applied:sip', 'write', 'applied:sip']);
    });
});
