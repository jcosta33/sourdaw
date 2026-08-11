import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { resumeEngine, requestMicPermission } from '#/modules/AudioEngine/useCases';
import { syncKneadToEngine } from '#/modules/Knead/useCases';
import { finishProjectLoading, loadProject, saveProject } from '#/modules/Project/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { useAppInitialization } from '../useAppInitialization';

const projectStoreMock = vi.hoisted(() => ({
    current: null as Record<string, unknown> | null,
    set: vi.fn(),
}));
const transportStateMock = vi.hoisted(() => ({ current: null as { isPlaying: boolean } | null }));
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
    setMasterGainValue: vi.fn(),
    resumeEngine: vi.fn(),
    requestMicPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('#/modules/MIDI/useCases', () => ({
    initWebMidi: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('#/modules/Knead/useCases', () => ({ syncKneadToEngine: vi.fn() }));
vi.mock('#/modules/PluginHost/useCases', () => ({ registerProModulationEffects: vi.fn() }));
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
vi.mock('#/modules/Transport/useCases', () => ({
    ensureTrackStrips: vi.fn(),
    getTransportState: vi.fn(() => transportStateMock.current),
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
const mockPreferencesValueHolder: { current: Record<string, unknown> | null } = { current: { uiScale: 1 } };
const preferenceListeners = vi.hoisted(() => new Set<() => void>());
// Mock the preferences store the hook imports from #/modules/Preferences/stores,
// so the mock actually intercepts it.
vi.mock('#/modules/Preferences/stores', () => ({
    preferencesStore: {
        get value(): Record<string, unknown> | null {
            return mockPreferencesValueHolder.current;
        },
        subscribe: vi.fn((listener: () => void) => {
            preferenceListeners.add(listener);
            return () => preferenceListeners.delete(listener);
        }),
    },
}));

beforeEach(() => {
    transportStateMock.current = null;
    preferenceListeners.clear();
});

describe('useAppInitialization — first-gesture engine resume', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        projectStoreMock.current = null;
        vi.mocked(resumeEngine).mockResolvedValue(undefined);
        vi.mocked(requestMicPermission).mockResolvedValue(false);
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

    // audit RT-8 — the listeners were registered `{ once: true }`, so unlocking
    // audio was single-use: the listener that fired removed itself whether or not
    // the resume succeeded.
    it('re-arms after a failed resume so a second gesture can retry', async () => {
        vi.mocked(resumeEngine).mockRejectedValueOnce(new Error('resume blocked')).mockResolvedValue(undefined);

        renderHook(() => useAppInitialization());
        window.dispatchEvent(new MouseEvent('click'));

        await vi.waitFor(() => {
            expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('Audio'), 'warning');
        });

        // The prompt says "click anywhere to try again" — with a one-shot listener
        // there was nothing behind it and this second click did nothing.
        window.dispatchEvent(new MouseEvent('click'));

        await vi.waitFor(() => {
            expect(resumeEngine).toHaveBeenCalledTimes(2);
        });
    });

    it('resumes again on a later gesture after a suspend/interrupt cycle', async () => {
        // The handler drops a gesture while a resume is still in flight, and the
        // guard clears in a `finally` microtask — so settle the chain between
        // cycles rather than dispatching straight after the call-count assertion.
        const settleResume = () => new Promise((resolve) => setTimeout(resolve, 0));

        renderHook(() => useAppInitialization());

        window.dispatchEvent(new MouseEvent('click'));
        await settleResume();
        expect(resumeEngine).toHaveBeenCalledTimes(1);

        // An OS-level interrupt or an explicit suspend later in the session leaves
        // the context suspended again; the next gesture has to unlock it. Once both
        // one-shot listeners had fired, nothing remained armed to do that.
        window.dispatchEvent(new MouseEvent('click'));
        await settleResume();
        expect(resumeEngine).toHaveBeenCalledTimes(2);

        window.dispatchEvent(new KeyboardEvent('keydown'));
        await settleResume();
        expect(resumeEngine).toHaveBeenCalledTimes(3);
    });

    it('collapses a rapid double gesture into a single in-flight resume', async () => {
        let releaseResume = (): void => {};
        vi.mocked(resumeEngine).mockReturnValue(
            new Promise<void>((resolve) => {
                releaseResume = () => resolve();
            })
        );

        renderHook(() => useAppInitialization());
        window.dispatchEvent(new MouseEvent('click'));
        window.dispatchEvent(new MouseEvent('click'));

        expect(resumeEngine).toHaveBeenCalledTimes(1);

        releaseResume();
        await vi.waitFor(() => {
            expect(notifyUser).not.toHaveBeenCalledWith(expect.stringContaining('Audio'), 'warning');
        });
    });

    it('does not prompt for the microphone on a gesture', () => {
        renderHook(() => useAppInitialization());

        window.dispatchEvent(new MouseEvent('click'));

        // The mic prompt used to fire on the first gesture for every user. The
        // recording path acquires its own stream, so the browser asks at first
        // actual record/monitor use instead.
        expect(requestMicPermission).not.toHaveBeenCalled();
    });

    it('stops resuming on gestures after unmount', async () => {
        const { unmount } = renderHook(() => useAppInitialization());

        window.dispatchEvent(new MouseEvent('click'));
        await vi.waitFor(() => {
            expect(resumeEngine).toHaveBeenCalledTimes(1);
        });

        unmount();
        window.dispatchEvent(new MouseEvent('click'));
        window.dispatchEvent(new KeyboardEvent('keydown'));

        expect(resumeEngine).toHaveBeenCalledTimes(1);
    });
});

describe('useAppInitialization — knead engine subscription teardown', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        projectStoreMock.current = null;
        vi.mocked(resumeEngine).mockResolvedValue(undefined);
        vi.mocked(requestMicPermission).mockResolvedValue(false);
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
        vi.mocked(requestMicPermission).mockResolvedValue(false);
        vi.mocked(saveProject).mockResolvedValue(true);
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

    it('does NOT persist when the autoSave preference is disabled', () => {
        // The "Auto Save" toggle must actually stop autosave: with autoSave:false
        // the 30s interval must never call saveProject.
        mockPreferencesValueHolder.current = { uiScale: 1, autoSave: false, autoSaveIntervalMs: 30_000 };

        renderHook(() => useAppInitialization());

        vi.advanceTimersByTime(90_000);

        expect(saveProject).not.toHaveBeenCalled();
    });

    it('fires saveProject on the preference-configured interval when autoSave is enabled', async () => {
        mockPreferencesValueHolder.current = { uiScale: 1, autoSave: true, autoSaveIntervalMs: 10_000 };
        projectStoreMock.current = { dirty: true };

        renderHook(() => useAppInitialization());

        await vi.advanceTimersByTimeAsync(10_000);
        expect(saveProject).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(20_000);
        expect(saveProject).toHaveBeenCalledTimes(3);
    });

    it('stops, starts, and re-arms autosave when preferences change mid-session', async () => {
        mockPreferencesValueHolder.current = { uiScale: 1, autoSave: false, autoSaveIntervalMs: 30_000 };
        projectStoreMock.current = { dirty: true };
        renderHook(() => useAppInitialization());

        await vi.advanceTimersByTimeAsync(60_000);
        expect(saveProject).not.toHaveBeenCalled();

        mockPreferencesValueHolder.current = { uiScale: 1, autoSave: true, autoSaveIntervalMs: 30_000 };
        act(() => {
            for (const listener of preferenceListeners) {
                listener();
            }
        });
        await vi.advanceTimersByTimeAsync(29_999);
        expect(saveProject).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(saveProject).toHaveBeenCalledOnce();

        mockPreferencesValueHolder.current = { uiScale: 1, autoSave: true, autoSaveIntervalMs: 60_000 };
        act(() => {
            for (const listener of preferenceListeners) {
                listener();
            }
        });
        await vi.advanceTimersByTimeAsync(59_999);
        expect(saveProject).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);
        expect(saveProject).toHaveBeenCalledTimes(2);

        mockPreferencesValueHolder.current = { uiScale: 1, autoSave: false, autoSaveIntervalMs: 60_000 };
        act(() => {
            for (const listener of preferenceListeners) {
                listener();
            }
        });
        await vi.advanceTimersByTimeAsync(120_000);
        expect(saveProject).toHaveBeenCalledTimes(2);
    });

    it('coalesces ticks while a project snapshot is still being saved', async () => {
        let finishFirstSave: ((saved: boolean) => void) | undefined;
        const firstSave = new Promise<boolean>((resolve) => {
            finishFirstSave = resolve;
        });
        vi.mocked(saveProject).mockReturnValueOnce(firstSave);
        mockPreferencesValueHolder.current = { uiScale: 1, autoSave: true, autoSaveIntervalMs: 10_000 };
        projectStoreMock.current = { dirty: true };
        renderHook(() => useAppInitialization());

        vi.advanceTimersByTime(30_000);
        expect(saveProject).toHaveBeenCalledOnce();

        await act(async () => {
            finishFirstSave?.(true);
            await firstSave;
        });

        expect(saveProject).toHaveBeenCalledTimes(2);
    });

    it('waits for the configured cadence after a pending autosave fails', async () => {
        let finishFirstSave: ((saved: boolean) => void) | undefined;
        const firstSave = new Promise<boolean>((resolve) => {
            finishFirstSave = resolve;
        });
        vi.mocked(saveProject).mockReturnValueOnce(firstSave);
        mockPreferencesValueHolder.current = { uiScale: 1, autoSave: true, autoSaveIntervalMs: 10_000 };
        projectStoreMock.current = { dirty: true };
        renderHook(() => useAppInitialization());

        vi.advanceTimersByTime(30_000);
        expect(saveProject).toHaveBeenCalledOnce();

        await act(async () => {
            finishFirstSave?.(false);
            await firstSave;
        });
        expect(saveProject).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(9_999);
        expect(saveProject).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);
        expect(saveProject).toHaveBeenCalledTimes(2);
    });

    it('does not rebuild a full project snapshot while the project is clean', () => {
        mockPreferencesValueHolder.current = { uiScale: 1, autoSave: true, autoSaveIntervalMs: 10_000 };
        projectStoreMock.current = { dirty: false };

        renderHook(() => useAppInitialization());

        vi.advanceTimersByTime(30_000);

        expect(saveProject).not.toHaveBeenCalled();
    });

    it('defers the full project snapshot until transport stops', () => {
        mockPreferencesValueHolder.current = { uiScale: 1, autoSave: true, autoSaveIntervalMs: 10_000 };
        projectStoreMock.current = { dirty: true };
        transportStateMock.current = { isPlaying: true };

        renderHook(() => useAppInitialization());

        vi.advanceTimersByTime(30_000);

        expect(saveProject).not.toHaveBeenCalled();

        transportStateMock.current = { isPlaying: false };
        vi.advanceTimersByTime(10_000);

        expect(saveProject).toHaveBeenCalledTimes(1);
    });

    it('defers autosave while project authority is being replaced', () => {
        mockPreferencesValueHolder.current = { uiScale: 1, autoSave: true, autoSaveIntervalMs: 10_000 };
        projectStoreMock.current = { dirty: true, loading: true };
        renderHook(() => useAppInitialization());

        vi.advanceTimersByTime(30_000);
        expect(saveProject).not.toHaveBeenCalled();

        projectStoreMock.current = { dirty: true, loading: false };
        vi.advanceTimersByTime(10_000);
        expect(saveProject).toHaveBeenCalledOnce();
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
        vi.mocked(requestMicPermission).mockResolvedValue(false);
        try {
            localStorage.setItem('wd:first-load-hint-shown', '1');
        } catch {
            // ignore: localStorage may be unavailable
        }
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('uses the project loader as the authoritative read after storage becomes empty', async () => {
        vi.mocked(loadProject).mockResolvedValueOnce(false);

        renderHook(() => useAppInitialization());

        await waitFor(() => {
            expect(loadProject).toHaveBeenCalledTimes(1);
        });
        expect(finishProjectLoading).not.toHaveBeenCalled();
        expect(projectStoreMock.set).not.toHaveBeenCalled();
    });

    it('uses the same authoritative load path for valid persisted startup', async () => {
        renderHook(() => useAppInitialization());

        await waitFor(() => {
            expect(loadProject).toHaveBeenCalledTimes(1);
        });
        expect(finishProjectLoading).not.toHaveBeenCalled();
        expect(projectStoreMock.set).not.toHaveBeenCalled();
    });

    it('surfaces corrupt or rootless persistence instead of completing first-run startup', async () => {
        vi.mocked(loadProject).mockRejectedValueOnce(new Error('persisted root disappeared'));

        renderHook(() => useAppInitialization());

        await waitFor(() => {
            expect(logger.error).toHaveBeenCalled();
        });
        expect(finishProjectLoading).not.toHaveBeenCalled();
        expect(loadProject).toHaveBeenCalledOnce();
    });
});

describe('useAppInitialization — first-load shortcut hint', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        projectStoreMock.current = null;
        mockPreferencesValueHolder.current = { uiScale: 1, autoSave: false, autoSaveIntervalMs: 30_000 };
        vi.mocked(resumeEngine).mockResolvedValue(undefined);
        vi.mocked(requestMicPermission).mockResolvedValue(false);
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
