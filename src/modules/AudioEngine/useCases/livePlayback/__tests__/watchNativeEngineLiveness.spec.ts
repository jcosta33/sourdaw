/**
 * The one-second poll that finds an engine which has stopped rendering, and
 * abandons the session it finds one under (#3635).
 *
 * `refreshEngineRtDiagnostics` is doubled at the use case, per its own module's
 * doc: a second real reader here would split its drain of the engine's event
 * ring with whatever else calls it. What the watch does with a stalled reading
 * is proven against the real `abandonNativeLiveGraphSession`; only its own
 * leaves are doubled, mirroring `nativeLiveGraphSession.spec.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { notRunningEngineRtDiagnostics, type EngineRtDiagnostics } from '../../../models/EngineRtDiagnostics';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { stopNativeEngineLivenessWatch } from '../stopNativeEngineLivenessWatch';
import { NATIVE_ENGINE_LIVENESS_POLL_MS, startNativeEngineLivenessWatch } from '../watchNativeEngineLiveness';

import type { AudioGraphBackend } from '../../../models/AudioGraphBackend';

const mocks = vi.hoisted(() => ({
    refreshEngineRtDiagnostics: vi.fn<() => Promise<EngineRtDiagnostics | null>>(),
    stopPlayheadFeed: vi.fn(),
    setNativeCarriedTracks: vi.fn<(trackIds: ReadonlySet<string>) => void>(),
    notifyUser: vi.fn<(message: string, level: string) => void>(),
    warn: vi.fn(),
}));

vi.mock('../../engineAccess/refreshEngineRtDiagnostics', () => ({
    refreshEngineRtDiagnostics: () => mocks.refreshEngineRtDiagnostics(),
}));
vi.mock('../startNativeEnginePlayheadFeed', () => ({ startNativeEnginePlayheadFeed: vi.fn() }));
vi.mock('../stopNativeEnginePlayheadFeed', () => ({
    stopNativeEnginePlayheadFeed: () => mocks.stopPlayheadFeed(),
}));
vi.mock('../../trackAudioControls/setNativeCarriedTracks', () => ({
    setNativeCarriedTracks: (trackIds: ReadonlySet<string>) => mocks.setNativeCarriedTracks(trackIds),
}));
vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: (message: string, level: string) => mocks.notifyUser(message, level),
}));
vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: vi.fn(), warn: mocks.warn, info: vi.fn(), debug: vi.fn() },
}));

function fakeBackend(): AudioGraphBackend & { dispose: ReturnType<typeof vi.fn<() => void>> } {
    return {
        backendId: 'stub-backend',
        apply: vi.fn<AudioGraphBackend['apply']>(),
        dispose: vi.fn<() => void>(),
    };
}

beforeEach(() => {
    vi.useFakeTimers();
    mocks.refreshEngineRtDiagnostics.mockReset();
    mocks.stopPlayheadFeed.mockClear();
    mocks.setNativeCarriedTracks.mockReset();
    mocks.notifyUser.mockClear();
    mocks.warn.mockClear();
    nativeLiveGraphSession.backend = fakeBackend();
    nativeLiveGraphSession.audibleCarrier = true;
    nativeLiveGraphSession.rolling = true;
    nativeLiveGraphSession.livenessWatch = null;
    nativeLiveGraphSession.pending = Promise.resolve();
});

afterEach(() => {
    stopNativeEngineLivenessWatch();
    nativeLiveGraphSession.backend = null;
    vi.useRealTimers();
});

describe('startNativeEngineLivenessWatch / stopNativeEngineLivenessWatch', () => {
    it('leaves the session standing on a reading that says the engine is running', async () => {
        mocks.refreshEngineRtDiagnostics.mockResolvedValue({ ...notRunningEngineRtDiagnostics, running: true });
        startNativeEngineLivenessWatch();

        await vi.advanceTimersByTimeAsync(NATIVE_ENGINE_LIVENESS_POLL_MS);

        expect(nativeLiveGraphSession.backend).not.toBeNull();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('abandons the session on a stalled reading, and clears the interval behind it', async () => {
        mocks.refreshEngineRtDiagnostics.mockResolvedValue({
            ...notRunningEngineRtDiagnostics,
            running: false,
            outputStreamFault: 'deviceChanged',
        });
        startNativeEngineLivenessWatch();

        await vi.advanceTimersByTimeAsync(NATIVE_ENGINE_LIVENESS_POLL_MS);

        expect(nativeLiveGraphSession.backend).toBeNull();
        const [message] = mocks.notifyUser.mock.calls[0] as [string, string];
        expect(message).toContain('deviceChanged');

        mocks.refreshEngineRtDiagnostics.mockClear();
        await vi.advanceTimersByTimeAsync(5_000);

        // The abandon stopped the watch, so nothing here should have polled
        // again — a live interval would have called this five more times.
        expect(mocks.refreshEngineRtDiagnostics).not.toHaveBeenCalled();
    });

    it('abandons the session the reading described', async () => {
        const firstSessionBackend = fakeBackend();
        nativeLiveGraphSession.backend = firstSessionBackend;
        let resolveRead = (_reading: EngineRtDiagnostics | null): void => undefined;
        mocks.refreshEngineRtDiagnostics.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveRead = resolve;
                })
        );
        startNativeEngineLivenessWatch();

        await vi.advanceTimersByTimeAsync(NATIVE_ENGINE_LIVENESS_POLL_MS);

        // Still the same session when the reading settles.
        resolveRead({ ...notRunningEngineRtDiagnostics, running: false, outputStreamFault: 'deviceChanged' });
        await vi.advanceTimersByTimeAsync(0);
        await nativeLiveGraphSession.pending;

        expect(nativeLiveGraphSession.backend).toBeNull();
        expect(firstSessionBackend.dispose).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
    });

    it('leaves a session installed after the reading untouched', async () => {
        let resolveRead = (_reading: EngineRtDiagnostics | null): void => undefined;
        mocks.refreshEngineRtDiagnostics.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveRead = resolve;
                })
        );
        startNativeEngineLivenessWatch();

        // The tick's reading is taken while the first session's backend still
        // stands, and is still in flight when a second session replaces it.
        await vi.advanceTimersByTimeAsync(NATIVE_ENGINE_LIVENESS_POLL_MS);
        const secondSessionBackend = fakeBackend();
        nativeLiveGraphSession.backend = secondSessionBackend;

        resolveRead({ ...notRunningEngineRtDiagnostics, running: false, outputStreamFault: 'deviceChanged' });
        await vi.advanceTimersByTimeAsync(0);
        await nativeLiveGraphSession.pending;

        // The stale reading describes the session that stood when it was
        // taken, not the one the queue finds current — the second session is
        // proof the engine rendered again, and this tick must not tear it down.
        expect(nativeLiveGraphSession.backend).toBe(secondSessionBackend);
        expect(secondSessionBackend.dispose).not.toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('leaves the session standing on a failed read, which answers null', async () => {
        mocks.refreshEngineRtDiagnostics.mockResolvedValue(null);
        startNativeEngineLivenessWatch();

        await vi.advanceTimersByTimeAsync(NATIVE_ENGINE_LIVENESS_POLL_MS);

        expect(nativeLiveGraphSession.backend).not.toBeNull();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('skips a tick whose previous read is still in flight, rather than doubling the bridge call', async () => {
        let resolveRead = (_reading: EngineRtDiagnostics | null): void => undefined;
        mocks.refreshEngineRtDiagnostics.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveRead = resolve;
                })
        );
        startNativeEngineLivenessWatch();

        // The first tick's read is still pending when the second tick fires.
        await vi.advanceTimersByTimeAsync(NATIVE_ENGINE_LIVENESS_POLL_MS * 2);

        expect(mocks.refreshEngineRtDiagnostics).toHaveBeenCalledTimes(1);
        // Settled and flushed before the test ends, so the in-flight guard is
        // clear again for whatever the next test's first tick finds.
        resolveRead({ ...notRunningEngineRtDiagnostics, running: true });
        await vi.advanceTimersByTimeAsync(0);
    });

    it('starts one interval however many times it is asked to', async () => {
        mocks.refreshEngineRtDiagnostics.mockResolvedValue({ ...notRunningEngineRtDiagnostics, running: true });
        startNativeEngineLivenessWatch();
        startNativeEngineLivenessWatch();

        await vi.advanceTimersByTimeAsync(NATIVE_ENGINE_LIVENESS_POLL_MS);

        expect(mocks.refreshEngineRtDiagnostics).toHaveBeenCalledTimes(1);
    });
});
