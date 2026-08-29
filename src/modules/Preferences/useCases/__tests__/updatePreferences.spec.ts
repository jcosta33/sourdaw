import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setSoloMode } from '#/modules/WorkspaceShell/useCases';

import { defaultPreferences, type Preferences } from '../../models/Preferences';
import { preferencesStore } from '../../stores/preferencesStore';
import { updatePreferences } from '../updatePreferences';

const mocks = vi.hoisted(() => ({
    preferencesStoreValue: { value: null as Preferences | null },
    preferencesStoreSet: vi.fn(),
    setSoloMode: vi.fn(),
}));

vi.mock('../../stores/preferencesStore', () => ({
    preferencesStore: {
        get value() {
            return mocks.preferencesStoreValue.value;
        },
        trySet: mocks.preferencesStoreSet,
    },
}));

vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    setSoloMode: mocks.setSoloMode,
}));

describe('updatePreferences', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.preferencesStoreValue.value = { ...defaultPreferences, theme: 'dark', soloMode: 'sip' };
    });

    it('should merge the patch into preferencesStore', () => {
        updatePreferences({ patch: { theme: 'light' } });

        expect(preferencesStore.trySet).toHaveBeenCalledWith({
            ...defaultPreferences,
            theme: 'light',
            soloMode: 'sip',
        });
        expect(setSoloMode).not.toHaveBeenCalled();
    });

    it('should synchronize Workspace soloMode when the patch changes soloMode', () => {
        updatePreferences({ patch: { soloMode: 'pfl' } });

        expect(preferencesStore.trySet).toHaveBeenCalledWith({
            ...defaultPreferences,
            theme: 'dark',
            soloMode: 'pfl',
        });
        expect(setSoloMode).toHaveBeenCalledWith('pfl');
    });

    it.each([0.5, 2])('should preserve a supported UI scale of %s', (uiScale) => {
        updatePreferences({ patch: { uiScale } });

        expect(preferencesStore.trySet).toHaveBeenCalledWith({
            ...defaultPreferences,
            theme: 'dark',
            soloMode: 'sip',
            uiScale,
        });
    });

    it.each([0, -1, 2.01, 100, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
        'should replace an unsupported UI scale of %s with the default',
        (uiScale) => {
            updatePreferences({ patch: { uiScale } });

            expect(preferencesStore.trySet).toHaveBeenCalledWith({
                ...defaultPreferences,
                theme: 'dark',
                soloMode: 'sip',
                uiScale: defaultPreferences.uiScale,
            });
        }
    );
});
