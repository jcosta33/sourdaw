import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { resumeEngine, requestMicPermission } from '#/modules/AudioEngine/useCases';
import { hasCrdtProject } from '#/modules/CrdtDocument/useCases';
import { syncKneadToEngine } from '#/modules/Knead/useCases';
import { finishProjectLoading, loadProject, saveProject } from '#/modules/Project/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { useAppInitialization } from '../useAppInitialization';

const projectStoreMock = vi.hoisted(() => ({
    current: null as Record<string, unknown> | null,
    set: vi.fn(),
}));
// The hook fans out into the whole app boot sequence; every collaborator is
// stubbed so the test can isolate the user-gesture effect (the fix-5 seam:
// resumeEngine() must no longer be fire-and-forget). Async members resolve so
// the mount effect's `await` chain settles without throwing.
vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    initializeAudioEngine: vi.fn().mockResolvedValue(undefined),
    getAudioContext: vi.fn(() => ({})),
    initWebMidi: vi.fn().mockResolvedValue(undefined),
    setMasterGainValue: vi.fn(),
    resumeEngine: vi.fn(),
    requestMicPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({ hasCrdtProject: vi.fn().mockResolvedValue(false) }));
vi.mock('#/modules/Knead/useCases', () => ({ syncKneadToEngine: vi.fn() }));
vi.mock('#/modules/Plugin/useCases', () => ({ registerProModulationEffects: vi.fn() }));
vi.mock('#/modules/Project/stores', () => ({
    projectStore: {
        get value(): Record<string, unknown> | null {
            return projectStoreMock.current;
        },
        set: projectStoreMock.set,
    },
}));
vi.mock('#/modules/Project/useCases', () => ({
    loadProject: vi.fn().mockResolvedValue(undefined),
    finishProjectLoading: vi.fn(),
    saveProject: vi.fn(),
}));
vi.mock('#/modules/SampleLibrary/useCases', () => ({
    restoreLibrary: vi.fn().mockResolvedValue(undefined),
    seedFactoryLibrary: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('#/modules/Synth/useCases', () => ({ registerProSynthInstruments: vi.fn() }));
vi.mock('#/modules/Transport/useCases', () => ({ ensureTrackStrips: vi.fn(), getTransportState: vi.fn(() => null) }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
const mockPreferencesValueHolder: { current: Record<string, unknown> | null } = { current: { uiScale: 1 } };
// Path resolves (from this __tests__ dir) to Workspace/stores/preferencesStore —
// the exact module the hook imports, so the mock actually intercepts it.
vi.mock('../../../stores/preferencesStore', () => ({
    preferencesStore: {
        get value(): Record<string, unknown> | null {
            return mockPreferencesValueHolder.current;
        },
        subscribe: vi.fn(() => () => {}),
    },
}));

describe('useAppInitialization — first-gesture engine resume', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        projectStoreMock.current = null;
        vi.mocked(resumeEngine).mockResolvedValue(undefined);
        vi.mocked(requestMicPermission).mockResolvedValue(undefined);
        try {
            localStorage.setItem('wd:first-load-hint-shown', '1');
        } catch {
            // ignore: localStorage may be unavailable
        }
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('resumes the engine on the first user gesture', () => {
        renderHook(() => useAppInitialization());

        window.dispatchEvent(new MouseEvent('click'));

        expect(resumeEngine).toHaveBeenCalledTimes(1);
    });

    it('warns the user when the first-gesture resume rejects instead of swallowing it', async () => {
        vi.mocked(resumeEngine).mockRejectedValue(new Error('resume blocked'));

        renderHook(() => useAppInitialization());
        window.dispatchEvent(new MouseEvent('click'));

        // A `void resumeEngine()` would discard the rejection; the fix attaches a
        // catch that surfaces the failure to the user.
        await vi.waitFor(() => {
            expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('Audio'), 'warning');
        });
    });
});

describe('useAppInitialization — knead engine subscription teardown', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        projectStoreMock.current = null;
        vi.mocked(resumeEngine).mockResolvedValue(undefined);
        vi.mocked(requestMicPermission).mockResolvedValue(undefined);
        try {
            localStorage.setItem('wd:first-load-hint-shown', '1');
        } catch {
            // ignore: localStorage may be unavailable
        }
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('unsubscribes the knead→engine sync on unmount instead of leaking the subscription', async () => {
        // Regression: the mount effect discarded the unsubscribe returned by
        // syncKneadToEngine() and had no cleanup, so the kneadStore/trackStore
        // subscribers accumulated on every remount/HMR. The fix captures the
        // unsubscribe and calls it from the effect's cleanup.
        const unsubscribe = vi.fn();
        vi.mocked(syncKneadToEngine).mockReturnValue(unsubscribe);

        const { unmount } = renderHook(() => useAppInitialization());

        // The subscription is registered inside the async boot sequence; wait for
        // it to land before tearing down.
        await waitFor(() => {
            expect(syncKneadToEngine).toHaveBeenCalledTimes(1);
        });
        expect(unsubscribe).not.toHaveBeenCalled();

        unmount();

        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
});

describe('useAppInitialization — autosave governed by preferences', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        projectStoreMock.current = null;
        vi.useFakeTimers();
        vi.mocked(resumeEngine).mockResolvedValue(undefined);
        vi.mocked(requestMicPermission).mockResolvedValue(undefined);
        mockPreferencesValueHolder.current = { uiScale: 1, autoSave: true, autoSaveIntervalMs: 30_000 };
        try {
            localStorage.setItem('wd:first-load-hint-shown', '1');
        } catch {
            // ignore: localStorage may be unavailable
        }
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('does NOT fire saveProject when the autoSave preference is disabled', () => {
        // The "Auto Save" toggle must actually stop autosave: with autoSave:false
        // the 30s interval must never call saveProject.
        mockPreferencesValueHolder.current = { uiScale: 1, autoSave: false, autoSaveIntervalMs: 30_000 };

        renderHook(() => useAppInitialization());

        vi.advanceTimersByTime(90_000);

        expect(saveProject).not.toHaveBeenCalled();
    });

    it('fires saveProject on the preference-configured interval when autoSave is enabled', () => {
        mockPreferencesValueHolder.current = { uiScale: 1, autoSave: true, autoSaveIntervalMs: 10_000 };

        renderHook(() => useAppInitialization());

        vi.advanceTimersByTime(10_000);
        expect(saveProject).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(20_000);
        expect(saveProject).toHaveBeenCalledTimes(3);
    });
});

describe('useAppInitialization — Project loading boundary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        projectStoreMock.current = {
            name: 'Untitled Project',
            loading: true,
            initialized: true,
        };
        vi.mocked(resumeEngine).mockResolvedValue(undefined);
        vi.mocked(requestMicPermission).mockResolvedValue(undefined);
        try {
            localStorage.setItem('wd:first-load-hint-shown', '1');
        } catch {
            // ignore: localStorage may be unavailable
        }
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('clears Project loading through the Project use case when no saved CRDT project exists', async () => {
        renderHook(() => useAppInitialization());

        await waitFor(() => {
            expect(finishProjectLoading).toHaveBeenCalledTimes(1);
        });
        expect(projectStoreMock.set).not.toHaveBeenCalled();
        expect(loadProject).not.toHaveBeenCalled();
    });

    it('loads a saved CRDT project instead of clearing Project loading directly', async () => {
        vi.mocked(hasCrdtProject).mockResolvedValueOnce(true);

        renderHook(() => useAppInitialization());

        await waitFor(() => {
            expect(loadProject).toHaveBeenCalledTimes(1);
        });
        expect(finishProjectLoading).not.toHaveBeenCalled();
        expect(projectStoreMock.set).not.toHaveBeenCalled();
    });
});

describe('useAppInitialization — first-load shortcut hint', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        projectStoreMock.current = null;
        mockPreferencesValueHolder.current = { uiScale: 1, autoSave: false, autoSaveIntervalMs: 30_000 };
        vi.mocked(resumeEngine).mockResolvedValue(undefined);
        vi.mocked(requestMicPermission).mockResolvedValue(undefined);
        try {
            localStorage.removeItem('wd:first-load-hint-shown');
        } catch {
            // ignore: localStorage may be unavailable
        }
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        try {
            localStorage.removeItem('wd:first-load-hint-shown');
        } catch {
            // ignore: localStorage may be unavailable
        }
    });

    it('shows neutral shortcut copy after the first-load delay and persists the shown flag', () => {
        renderHook(() => useAppInitialization());

        act(() => {
            vi.advanceTimersByTime(2999);
        });

        expect(notifyUser).not.toHaveBeenCalledWith('Press ? for shortcuts · Cmd/Ctrl+K to search commands', 'info');

        act(() => {
            vi.advanceTimersByTime(1);
        });

        expect(notifyUser).toHaveBeenCalledWith('Press ? for shortcuts · Cmd/Ctrl+K to search commands', 'info');
        expect(localStorage.getItem('wd:first-load-hint-shown')).toBe('1');
    });
});
