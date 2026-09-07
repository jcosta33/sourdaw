/**
 * The one-second poll that finds an engine which has stopped rendering,
 * abandons the session it finds one under, and parks an already-abandoned
 * engine once it renders again (#3635).
 *
 * `refreshEngineRtDiagnostics` is doubled at the use case, per its own module's
 * doc: a second real reader here would split its drain of the engine's event
 * ring with whatever else calls it. What the watch does with a stalled reading
 * is proven against the real `abandonNativeLiveGraphSession` and
 * `parkOrphanedNativeEngine`; only its own leaves are doubled, mirroring
 * `nativeLiveGraphSession.spec.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { notRunningEngineRtDiagnostics, type EngineRtDiagnostics } from '../../../models/EngineRtDiagnostics';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { stopNativeEngineLivenessWatch } from '../stopNativeEngineLivenessWatch';
import { NATIVE_ENGINE_LIVENESS_POLL_MS, startNativeEngineLivenessWatch } from '../watchNativeEngineLiveness';

import type { AudioGraphBackend } from '../../../models/AudioGraphBackend';

const mocks = vi.hoisted(() => ({
    refreshEngineRtDiagnostics: vi.fn<() => Promise<EngineRtDiagnostics | null>>(),
    retireNativeEngine: vi.fn<() => Promise<{ outcome: string; retiredInstanceIds: readonly string[] }>>(),
    forgetRetiredPluginInstances: vi.fn<(instanceIds: readonly string[]) => void>(),
    stopPlayheadFeed: vi.fn(),
    setNativeCarriedTracks: vi.fn<(trackIds: ReadonlySet<string>) => void>(),
    notifyUser: vi.fn<(message: string, level: string) => void>(),
    warn: vi.fn(),
}));

vi.mock('../../engineAccess/refreshEngineRtDiagnostics', () => ({
    refreshEngineRtDiagnostics: () => mocks.refreshEngineRtDiagnostics(),
}));
vi.mock('../../../repositories/engineLifecycle/retireNativeEngine', () => ({
    retireNativeEngine: () => mocks.retireNativeEngine(),
}));
vi.mock('#/modules/PluginHost/useCases', () => ({
    forgetRetiredPluginInstances: (instanceIds: readonly string[]) => mocks.forgetRetiredPluginInstances(instanceIds),
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

function fakeBackend(): AudioGraphBackend & {
    apply: ReturnType<typeof vi.fn<AudioGraphBackend['apply']>>;
    dispose: ReturnType<typeof vi.fn<() => void>>;
} {
    return {
        backendId: 'stub-backend',
        apply: vi.fn<AudioGraphBackend['apply']>(),
        dispose: vi.fn<() => void>(),
    };
}

beforeEach(() => {
    vi.useFakeTimers();
    mocks.refreshEngineRtDiagnostics.mockReset();
    mocks.retireNativeEngine.mockReset();
    // A retire that finds the engine rendering leaves the orphan exactly where
    // it was, so it is the default that changes nothing for the park cases.
    mocks.retireNativeEngine.mockResolvedValue({ outcome: 'rendering', retiredInstanceIds: [] });
    mocks.forgetRetiredPluginInstances.mockReset();
    mocks.stopPlayheadFeed.mockClear();
    mocks.setNativeCarriedTracks.mockReset();
    mocks.notifyUser.mockClear();
    mocks.warn.mockClear();
    nativeLiveGraphSession.backend = fakeBackend();
    nativeLiveGraphSession.orphanedBackend = null;
    nativeLiveGraphSession.audibleCarrier = true;
    nativeLiveGraphSession.rolling = true;
    nativeLiveGraphSession.livenessWatch = null;
    nativeLiveGraphSession.pending = Promise.resolve();
});

afterEach(() => {
    stopNativeEngineLivenessWatch();
    nativeLiveGraphSession.backend = null;
    nativeLiveGraphSession.orphanedBackend = null;
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

    it('keeps the watch running past the abandon, parks the orphan once the engine renders again, then retires', async () => {
        const backend = nativeLiveGraphSession.backend as ReturnType<typeof fakeBackend>;
        mocks.refreshEngineRtDiagnostics.mockResolvedValue({
            ...notRunningEngineRtDiagnostics,
            running: false,
            outputStreamFault: 'deviceChanged',
        });
        startNativeEngineLivenessWatch();

        await vi.advanceTimersByTimeAsync(NATIVE_ENGINE_LIVENESS_POLL_MS);
        await nativeLiveGraphSession.pending;

        expect(nativeLiveGraphSession.backend).toBeNull();
        expect(nativeLiveGraphSession.orphanedBackend).toBe(backend);
        const [message] = mocks.notifyUser.mock.calls[0] as [string, string];
        expect(message).toContain('deviceChanged');
        // The abandon left the watch running: there is still an orphan for it
        // to park, so it must not have stopped itself the way it used to when
        // an abandon dropped the handle outright.
        expect(nativeLiveGraphSession.livenessWatch).not.toBeNull();

        backend.apply.mockResolvedValue({
            acceptance: 'accepted',
            application: 'applied',
            runtimeRevision: 1,
            reports: [],
        });
        mocks.refreshEngineRtDiagnostics.mockResolvedValue({ ...notRunningEngineRtDiagnostics, running: true });

        await vi.advanceTimersByTimeAsync(NATIVE_ENGINE_LIVENESS_POLL_MS);
        await nativeLiveGraphSession.pending;

        expect(backend.apply).toHaveBeenCalledWith({
            schemaVersion: 1,
            commands: [{ kind: 'set-transport', playing: false, positionSeconds: 0 }],
        });
        expect(backend.dispose).toHaveBeenCalledTimes(1);
        expect(nativeLiveGraphSession.orphanedBackend).toBeNull();

        mocks.refreshEngineRtDiagnostics.mockClear();
        await vi.advanceTimersByTimeAsync(NATIVE_ENGINE_LIVENESS_POLL_MS);

        // Nothing left to watch — no session, no orphan — so the watch
        // retired itself rather than reading again.
        expect(nativeLiveGraphSession.livenessWatch).toBeNull();
        expect(mocks.refreshEngineRtDiagnostics).not.toHaveBeenCalled();
    });

    it('keeps the orphan when the park is refused, and retries on the next running reading', async () => {
        const backend = nativeLiveGraphSession.backend as ReturnType<typeof fakeBackend>;
        mocks.refreshEngineRtDiagnostics.mockResolvedValue({
            ...notRunningEngineRtDiagnostics,
            running: false,
            outputStreamFault: 'deviceChanged',
        });
        startNativeEngineLivenessWatch();
        await vi.advanceTimersByTimeAsync(NATIVE_ENGINE_LIVENESS_POLL_MS);
        await nativeLiveGraphSession.pending;
        expect(nativeLiveGraphSession.orphanedBackend).toBe(backend);

        backend.apply.mockResolvedValue({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'command-queue-full',
        });
        mocks.refreshEngineRtDiagnostics.mockResolvedValue({ ...notRunningEngineRtDiagnostics, running: true });

        await vi.advanceTimersByTimeAsync(NATIVE_ENGINE_LIVENESS_POLL_MS);
        await nativeLiveGraphSession.pending;

        expect(backend.dispose).not.toHaveBeenCalled();
        expect(nativeLiveGraphSession.orphanedBackend).toBe(backend);
        expect(backend.apply).toHaveBeenCalledTimes(1);

        // A later reading that still says the engine renders retries the park.
        await vi.advanceTimersByTimeAsync(NATIVE_ENGINE_LIVENESS_POLL_MS);
        await nativeLiveGraphSession.pending;

        expect(backend.apply).toHaveBeenCalledTimes(2);
    });

    it('retains the orphan when the transport answers the park unreadably, and retries on the next running reading', async () => {
        const orphan = nativeLiveGraphSession.backend as ReturnType<typeof fakeBackend>;
        mocks.refreshEngineRtDiagnostics.mockResolvedValue({
            ...notRunningEngineRtDiagnostics,
            running: false,
            outputStreamFault: 'deviceChanged',
        });
        startNativeEngineLivenessWatch();
        await vi.advanceTimersByTimeAsync(NATIVE_ENGINE_LIVENESS_POLL_MS);
        await nativeLiveGraphSession.pending;
        expect(nativeLiveGraphSession.orphanedBackend).toBe(orphan);

        orphan.apply.mockRejectedValueOnce(new Error('unreadable'));
        mocks.refreshEngineRtDiagnostics.mockResolvedValue({ ...notRunningEngineRtDiagnostics, running: true });

        await vi.advanceTimersByTimeAsync(NATIVE_ENGINE_LIVENESS_POLL_MS);
        await nativeLiveGraphSession.pending;

        // A thrown apply is an unreadable answer, not a rejection the bridge
        // reported — the engine may still be rolling, so the orphan is kept
        // rather than disposed.
        expect(nativeLiveGraphSession.orphanedBackend).toBe(orphan);
        expect(orphan.dispose).not.toHaveBeenCalled();
        expect(nativeLiveGraphSession.livenessWatch).not.toBeNull();
        expect(mocks.warn).toHaveBeenCalledTimes(1);
        const [warning] = mocks.warn.mock.calls[0] as [string];
        expect(warning).toContain('orphan park');

        await vi.advanceTimersByTimeAsync(NATIVE_ENGINE_LIVENESS_POLL_MS);
        await nativeLiveGraphSession.pending;

        expect(orphan.apply).toHaveBeenCalledTimes(2);
    });

    it('retires the engine instead of parking it while the orphan’s stream is still down', async () => {
        const backend = nativeLiveGraphSession.backend as ReturnType<typeof fakeBackend>;
        mocks.refreshEngineRtDiagnostics.mockResolvedValue({
            ...notRunningEngineRtDiagnostics,
            running: false,
            outputStreamFault: 'deviceChanged',
        });
        startNativeEngineLivenessWatch();
        await vi.advanceTimersByTimeAsync(NATIVE_ENGINE_LIVENESS_POLL_MS);
        await nativeLiveGraphSession.pending;
        expect(nativeLiveGraphSession.orphanedBackend).toBe(backend);
        expect(mocks.retireNativeEngine).not.toHaveBeenCalled();

        mocks.retireNativeEngine.mockResolvedValue({ outcome: 'retired', retiredInstanceIds: ['inst-1'] });

        await vi.advanceTimersByTimeAsync(NATIVE_ENGINE_LIVENESS_POLL_MS);
        await nativeLiveGraphSession.pending;

        // A park would have sent a set-transport batch through this handle; the
        // engine is not rendering, so the slot is emptied instead.
        expect(backend.apply).not.toHaveBeenCalled();
        expect(mocks.retireNativeEngine).toHaveBeenCalledTimes(1);
        expect(nativeLiveGraphSession.orphanedBackend).toBeNull();
    });

    it('retires itself when neither a session nor an orphan exists', async () => {
        nativeLiveGraphSession.backend = null;
        nativeLiveGraphSession.orphanedBackend = null;
        startNativeEngineLivenessWatch();

        await vi.advanceTimersByTimeAsync(NATIVE_ENGINE_LIVENESS_POLL_MS);

        expect(nativeLiveGraphSession.livenessWatch).toBeNull();
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
        // Orphaned, not disposed — the watch keeps this handle to park once
        // the engine renders again.
        expect(firstSessionBackend.dispose).not.toHaveBeenCalled();
        expect(nativeLiveGraphSession.orphanedBackend).toBe(firstSessionBackend);
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
