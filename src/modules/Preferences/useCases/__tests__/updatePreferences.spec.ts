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
});
