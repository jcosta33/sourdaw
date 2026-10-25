import { stringify } from 'superjson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { preferencesStore } from '#/modules/Preferences/stores';
import {
    defaultPreferences,
    onSoloModePreferenceApplied,
    resetPreferences,
    setTimelineMinimapHeight,
    setTrackHeight,
    updatePreferences,
} from '#/modules/Preferences/useCases';

import { defaultWorkspaceState, workspaceStore } from '../../../../stores/workspaceStore';
import { setSoloMode } from '../setSoloMode';
import { syncSoloModePreference } from '../syncSoloModePreference';

describe('syncSoloModePreference', () => {
    let unsubscribe: (() => void) | null = null;

    beforeEach(() => {
        preferencesStore.trySet(defaultPreferences);
        workspaceStore.set(defaultWorkspaceState);
    });

    afterEach(() => {
        unsubscribe?.();
        unsubscribe = null;
        preferencesStore.trySet(defaultPreferences);
        workspaceStore.set(defaultWorkspaceState);
    });

    it('applies the saved mode and synchronously follows preference updates and reset', () => {
        updatePreferences({ patch: { soloMode: 'afl' } });
        unsubscribe = syncSoloModePreference();
        expect(workspaceStore.value?.soloMode).toBe('afl');

        updatePreferences({ patch: { soloMode: 'pfl' } });
        expect(workspaceStore.value?.soloMode).toBe('pfl');

        resetPreferences();
        expect(workspaceStore.value?.soloMode).toBe(defaultPreferences.soloMode);

        unsubscribe();
        unsubscribe = null;
        updatePreferences({ patch: { soloMode: 'afl' } });
        expect(workspaceStore.value?.soloMode).toBe(defaultPreferences.soloMode);
    });

    it('leaves a session-only WorkspaceShell choice alone on unrelated preference writes', () => {
        unsubscribe = syncSoloModePreference();
        setSoloMode('pfl');

        updatePreferences({ patch: { elasticTransientSensitivity: 0.82 } });
        updatePreferences({ patch: { uiScale: 1.25 } });
        updatePreferences({ patch: { theme: 'light' } });
        setTrackHeight('large');
        setTimelineMinimapHeight(32);

        expect(workspaceStore.value?.soloMode).toBe('pfl');
        expect(preferencesStore.value?.soloMode).toBe(defaultPreferences.soloMode);
    });

    it('reapplies an explicit saved choice after a session-only toolbar choice', () => {
        updatePreferences({ patch: { soloMode: 'afl' } });
        unsubscribe = syncSoloModePreference();
        setSoloMode('pfl');

        updatePreferences({ patch: { soloMode: 'afl' } });

        expect(workspaceStore.value?.soloMode).toBe('afl');
    });

    it('reapplies the default on Reset even when the saved value is already default', () => {
        unsubscribe = syncSoloModePreference();
        setSoloMode('afl');

        resetPreferences();

        expect(workspaceStore.value?.soloMode).toBe(defaultPreferences.soloMode);
    });

    it('applies explicit outcomes immediately with pending observers before and after the owner', async () => {
        let releasePending: (() => void) | undefined;
        const pending = new Promise<void>((resolve) => {
            releasePending = resolve;
        });
        const stopEarlier = onSoloModePreferenceApplied(() => pending);
        unsubscribe = syncSoloModePreference();
        const stopLater = onSoloModePreferenceApplied(() => pending);
        try {
            setSoloMode('pfl');
            updatePreferences({ patch: { soloMode: 'sip' } });
            expect(workspaceStore.value?.soloMode).toBe('sip');

            setSoloMode('afl');
            resetPreferences();
            expect(workspaceStore.value?.soloMode).toBe('sip');
        } finally {
            stopEarlier();
            stopLater();
            releasePending?.();
        }
        await pending;
    });

    it('applies the preference when an earlier observer throws and reports the observer failure', () => {
        const error = new Error('observer refused');
        const warning = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const stopThrowing = onSoloModePreferenceApplied(() => {
            throw error;
        });
        unsubscribe = syncSoloModePreference();
        try {
            setSoloMode('afl');
            resetPreferences();
            expect(workspaceStore.value?.soloMode).toBe('sip');
            expect(warning).toHaveBeenCalledWith('Error in event handler for preferences.soloModeApplied:', error);
        } finally {
            stopThrowing();
            warning.mockRestore();
        }
    });

    it('loads an already saved mode from the client preferences key on a fresh mount', async () => {
        window.localStorage.setItem('sourdaw-preferences', stringify({ ...defaultPreferences, soloMode: 'afl' }));
        vi.resetModules();
        const [
            { preferencesStore: loadedPreferences },
            { workspaceStore: freshWorkspace },
            { syncSoloModePreference: sync },
        ] = await Promise.all([
            import('#/modules/Preferences/stores'),
            import('../../../../stores/workspaceStore'),
            import('../syncSoloModePreference'),
        ]);
        const stop = sync();
        try {
            expect(loadedPreferences.value?.soloMode).toBe('afl');
            expect(freshWorkspace.value?.soloMode).toBe('afl');
        } finally {
            stop();
            window.localStorage.removeItem('sourdaw-preferences');
        }
    });
});
