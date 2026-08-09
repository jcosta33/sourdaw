import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setSoloMode } from '#/modules/WorkspaceShell/useCases';

import { defaultPreferences } from '../../models/Preferences';
import { preferencesStore } from '../../stores/preferencesStore';
import { resetPreferences } from '../resetPreferences';

const mocks = vi.hoisted(() => ({
    preferencesStoreSet: vi.fn(),
    setSoloMode: vi.fn(),
}));

vi.mock('../../stores/preferencesStore', () => ({
    preferencesStore: {
        trySet: mocks.preferencesStoreSet,
    },
}));

vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    setSoloMode: mocks.setSoloMode,
}));

describe('resetPreferences', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should reset preferencesStore to defaults and synchronize Workspace soloMode', () => {
        resetPreferences();

        expect(preferencesStore.trySet).toHaveBeenCalledWith(defaultPreferences);
        expect(setSoloMode).toHaveBeenCalledWith(defaultPreferences.soloMode);
    });
});
