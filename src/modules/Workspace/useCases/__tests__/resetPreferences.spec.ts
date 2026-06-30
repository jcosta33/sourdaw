import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultPreferences } from '../../models/Preferences';
import { preferencesStore } from '../../stores/preferencesStore';
import { resetPreferences } from '../resetPreferences';
import { setSoloMode } from '../togglePanel/panelToggles/setSoloMode';

const mocks = vi.hoisted(() => ({
    preferencesStoreSet: vi.fn(),
    setSoloMode: vi.fn(),
}));

vi.mock('../../stores/preferencesStore', () => ({
    preferencesStore: {
        set: mocks.preferencesStoreSet,
    },
}));

vi.mock('../togglePanel/panelToggles/setSoloMode', () => ({
    setSoloMode: mocks.setSoloMode,
}));

describe('resetPreferences', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should reset preferencesStore to defaults and synchronize Workspace soloMode', () => {
        resetPreferences();

        expect(preferencesStore.set).toHaveBeenCalledWith(defaultPreferences);
        expect(setSoloMode).toHaveBeenCalledWith(defaultPreferences.soloMode);
    });
});
