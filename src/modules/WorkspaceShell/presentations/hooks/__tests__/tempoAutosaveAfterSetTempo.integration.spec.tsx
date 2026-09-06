import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const saveProjectSpy = vi.hoisted(() => vi.fn<() => Promise<boolean>>());

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getAudioContext: vi.fn(() => ({})),
    initializeAudioEngine: vi.fn().mockResolvedValue(undefined),
    resumeEngine: vi.fn().mockResolvedValue(undefined),
    setMasterGainValue: vi.fn(),
    syncNativeTimelineSamples: vi.fn(() => vi.fn()),
}));
vi.mock('#/modules/Knead/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Knead/useCases')>()),
    syncKneadToEngine: vi.fn(() => vi.fn()),
}));
vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    initWebMidi: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('#/modules/Project/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Project/useCases')>()),
    loadProject: vi.fn().mockResolvedValue(undefined),
    reportProjectLoadFailure: vi.fn(),
    saveProject: saveProjectSpy,
    whenProjectIdentityTransitionDependenciesConfigured: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('#/modules/SampleLibrary/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/SampleLibrary/useCases')>()),
    restoreLibrary: vi.fn().mockResolvedValue(undefined),
    seedFactoryLibrary: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('#/modules/Synth/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Synth/useCases')>()),
    registerProSynthInstruments: vi.fn(),
}));
vi.mock('#/modules/Transport/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/useCases')>()),
    ensureTrackStrips: vi.fn(),
    syncTransportMapsToNativeSession: vi.fn(() => vi.fn()),
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

import { Container } from '#/infra/di/Container';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { preferencesStore } from '#/modules/Preferences/stores';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { initProjectDirtyTracking } from '#/modules/Project/useCases';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { getTransportHandlers } from '#/modules/Transport/useCases';

import { useAppInitialization } from '../useAppInitialization';

describe('tempo edit autosave integration', () => {
    let disposeDirtyTracking: (() => void) | undefined;
    let previousPreferences: typeof preferencesStore.value;
    let previousFirstLoadHint: string | null;

    beforeEach(() => {
        vi.useFakeTimers();
        saveProjectSpy.mockReset();
        saveProjectSpy.mockResolvedValue(true);
        Container.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('tempo edit autosave integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getTransportHandlers());
        clearUndoHistory();
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            loading: false,
            initialized: true,
            dirty: false,
        });
        transportStore.set({ ...defaultTransportState, tempo: 120, isPlaying: false });
        tempoMapStore.set({ changes: [] });
        previousPreferences = preferencesStore.value;
        if (!previousPreferences) {
            throw new Error('Expected initialized preferences');
        }
        preferencesStore.set({ ...previousPreferences, autoSave: true, autoSaveIntervalMs: 30_000 });
        previousFirstLoadHint = localStorage.getItem('wd:first-load-hint-shown');
        localStorage.setItem('wd:first-load-hint-shown', '1');
        disposeDirtyTracking = initProjectDirtyTracking();
    });

    afterEach(() => {
        disposeDirtyTracking?.();
        if (previousPreferences) {
            preferencesStore.set(previousPreferences);
        }
        if (previousFirstLoadHint === null) {
            localStorage.removeItem('wd:first-load-hint-shown');
        } else {
            localStorage.setItem('wd:first-load-hint-shown', previousFirstLoadHint);
        }
        vi.useRealTimers();
        clearUndoHistory();
        clearHandlerRegistry();
        Container.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('calls saveProject on the timer after a committed tempo edit marks the initialized project dirty', async () => {
        const hook = renderHook(() => useAppInitialization());
        try {
            await vi.advanceTimersByTimeAsync(30_000);
            expect(saveProjectSpy).not.toHaveBeenCalled();

            await executeAppAction({ type: 'setTempo', payload: { bpm: 133 } });
            expect(projectStore.value?.dirty).toBe(true);

            await vi.advanceTimersByTimeAsync(30_000);
            expect(saveProjectSpy).toHaveBeenCalledOnce();
        } finally {
            hook.unmount();
        }
    });
});
