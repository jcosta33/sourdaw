/**
 * What the renderer does with the engine slot a stalled session left behind
 * (#3960).
 *
 * The doubled boundary is `retireNativeEngine`, the repository root that owns
 * the command, and `#/modules/PluginHost/useCases`, the foreign contract this
 * use case reaches for. Everything else is real: the session state it clears
 * and the store it publishes the offer on are what a caller observes.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultNativeEngineRearmState, nativeEngineRearmStore } from '../../../stores/nativeEngineRearmStore';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { retireOrphanedNativeEngine } from '../retireOrphanedNativeEngine';
// Real, not mocked: the pending count a start raises is what this retire reads,
// so only the live start can prove the two agree on when it is raised and when
// it comes back down.
import { startNativeLiveGraphSession } from '../startNativeLiveGraphSession';

import type { AudioGraphBackend } from '../../../models/AudioGraphBackend';
import type { RetireNativeEngineResult } from '../../../models/RetireNativeEngineOutcome';

const mocks = vi.hoisted(() => ({
    retireNativeEngine: vi.fn<() => Promise<RetireNativeEngineResult>>(),
    forgetRetiredPluginInstances: vi.fn<(instanceIds: readonly string[]) => void>(),
    warn: vi.fn(),
}));

vi.mock('../../../repositories/engineLifecycle/retireNativeEngine', () => ({
    retireNativeEngine: () => mocks.retireNativeEngine(),
}));
vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => {
    // Spread rather than replaced: the start imported above reaches this same
    // barrel for the attach correction, and a factory naming one export would
    // break its import rather than double the one call this file owns.
    const actual = await importOriginal<typeof import('#/modules/PluginHost/useCases')>();
    return {
        ...actual,
        forgetRetiredPluginInstances: (instanceIds: readonly string[]) =>
            mocks.forgetRetiredPluginInstances(instanceIds),
    };
});
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

function offers(): number {
    return (nativeEngineRearmStore.value ?? defaultNativeEngineRearmState).offers;
}

/** The least a start needs to be asked for; it declines on the missing bridge. */
const FLAT_MAPS = {
    tempo: [{ startSeconds: 0, beatsPerMinute: 120 }],
    timeSignature: [{ startSeconds: 0, numerator: 4, denominator: 4 }],
    loopRegion: { enabled: false, startSeconds: 0, endSeconds: 0 },
};

describe('retireOrphanedNativeEngine', () => {
    beforeEach(() => {
        mocks.retireNativeEngine.mockReset();
        mocks.forgetRetiredPluginInstances.mockReset();
        mocks.warn.mockClear();
        nativeEngineRearmStore.set(defaultNativeEngineRearmState);
        nativeLiveGraphSession.backend = null;
        nativeLiveGraphSession.orphanedBackend = null;
        nativeLiveGraphSession.rearmEpoch = 0;
        nativeLiveGraphSession.startsPending = 0;
        nativeLiveGraphSession.pending = Promise.resolve();
    });

    it('drops the orphan, forgets the instances it destroyed, and offers a re-arm', async () => {
        const orphan = fakeBackend();
        nativeLiveGraphSession.orphanedBackend = orphan;
        mocks.retireNativeEngine.mockResolvedValue({
            outcome: 'retired',
            retiredInstanceIds: ['inst-1', 'inst-2'],
        });

        await retireOrphanedNativeEngine();

        expect(orphan.dispose).toHaveBeenCalledTimes(1);
        expect(nativeLiveGraphSession.orphanedBackend).toBeNull();
        expect(mocks.forgetRetiredPluginInstances).toHaveBeenCalledWith(['inst-1', 'inst-2']);
        expect(offers()).toBe(1);
    });

    it('forgets the instances before it publishes the offer', async () => {
        const orphan = fakeBackend();
        nativeLiveGraphSession.orphanedBackend = orphan;
        mocks.retireNativeEngine.mockResolvedValue({
            outcome: 'retired',
            retiredInstanceIds: ['inst-1', 'inst-2'],
        });

        let forgetCallsSeenByOffer = -1;
        const unsubscribe = nativeEngineRearmStore.subscribe(() => {
            forgetCallsSeenByOffer = mocks.forgetRetiredPluginInstances.mock.calls.length;
        });

        try {
            await retireOrphanedNativeEngine();
        } finally {
            unsubscribe();
        }

        // A re-armed session's ensureTrackStrips short-circuits on an instance
        // PluginHost still believes is live, so the offer's subscriber must see
        // the forget already done, not merely queued.
        expect(forgetCallsSeenByOffer).toBe(1);
    });

    it('drops a spent orphan on an empty slot without offering anything to re-arm', async () => {
        const orphan = fakeBackend();
        nativeLiveGraphSession.orphanedBackend = orphan;
        mocks.retireNativeEngine.mockResolvedValue({ outcome: 'no-engine', retiredInstanceIds: [] });

        await retireOrphanedNativeEngine();

        expect(orphan.dispose).toHaveBeenCalledTimes(1);
        expect(nativeLiveGraphSession.orphanedBackend).toBeNull();
        // Nothing was retired, so there is nothing to reload and no session to
        // rebuild on this musician's behalf.
        expect(mocks.forgetRetiredPluginInstances).not.toHaveBeenCalled();
        expect(offers()).toBe(0);
    });

    it('keeps the orphan when the engine came back between the reading and the command', async () => {
        const orphan = fakeBackend();
        nativeLiveGraphSession.orphanedBackend = orphan;
        mocks.retireNativeEngine.mockResolvedValue({ outcome: 'rendering', retiredInstanceIds: [] });

        await retireOrphanedNativeEngine();

        // The park arm owns a rendering engine, and it needs this handle.
        expect(orphan.dispose).not.toHaveBeenCalled();
        expect(nativeLiveGraphSession.orphanedBackend).toBe(orphan);
        expect(offers()).toBe(0);
    });

    it('keeps the orphan when the command answers unreadably', async () => {
        const orphan = fakeBackend();
        nativeLiveGraphSession.orphanedBackend = orphan;
        mocks.retireNativeEngine.mockRejectedValue(new Error('unrecognized retire_native_engine outcome: undefined'));

        await retireOrphanedNativeEngine();

        expect(orphan.dispose).not.toHaveBeenCalled();
        expect(nativeLiveGraphSession.orphanedBackend).toBe(orphan);
        expect(offers()).toBe(0);
        expect(mocks.warn).toHaveBeenCalledTimes(1);
        const [warning] = mocks.warn.mock.calls[0] as [string];
        expect(warning).toContain('orphan retire');
    });

    it('withholds the offer when a start was requested while the retire was in flight', async () => {
        // Stop-then-Play inside the retire's own round trip: both gestures queue
        // behind it, so the transport is in a play whose Web Audio start has not
        // sounded a frame yet. An offer here would be claimed against that play
        // and anchored `rolling` on a transport that has not moved, putting the
        // re-armed roll a hold's worth ahead of everything audible.
        const orphan = fakeBackend();
        nativeLiveGraphSession.orphanedBackend = orphan;
        let superseding: Promise<unknown> = Promise.resolve();
        mocks.retireNativeEngine.mockImplementation(() => {
            // The play lands while the retire command is in the air. The start
            // declines here (no desktop bridge), which is immaterial: it raises
            // the pending count synchronously, and that is what the retire
            // reads.
            superseding = startNativeLiveGraphSession({
                positionSeconds: 0,
                transport: { kind: 'held', webAudioRollingSince: () => null },
                transportMaps: FLAT_MAPS,
                sampleRate: 48_000,
            });
            return Promise.resolve({ outcome: 'retired', retiredInstanceIds: ['inst-1'] });
        });

        await retireOrphanedNativeEngine();
        await superseding;

        // The engine this call retired is still gone, and the instances it
        // destroyed are still forgotten — both belong to the engine, not to the
        // play. Only the offer is withheld.
        expect(orphan.dispose).toHaveBeenCalledTimes(1);
        expect(mocks.forgetRetiredPluginInstances).toHaveBeenCalledWith(['inst-1']);
        expect(offers()).toBe(0);
    });

    it('withholds the offer when a start is queued behind the retire', async () => {
        // The play lands while this retire is still in the air, so the start's
        // own work queues behind it and has not run when the offer would go
        // out: nothing has bumped since the retire began, and the orphan the
        // start will replace is still standing. Only a pending start being
        // counted at all says the session is already spoken for.
        const orphan = fakeBackend();
        nativeLiveGraphSession.orphanedBackend = orphan;
        let answerCommand = (): void => {};
        const commandAnswered = new Promise<void>((resolve) => {
            answerCommand = (): void => {
                resolve();
            };
        });
        mocks.retireNativeEngine.mockImplementation(async () => {
            await commandAnswered;
            return { outcome: 'retired', retiredInstanceIds: ['inst-1'] };
        });

        const retiring = retireOrphanedNativeEngine();
        // Behind the retire on the session's chain, which is what makes this
        // start invisible to anything the retire samples about the engine.
        const superseding = startNativeLiveGraphSession({
            positionSeconds: 0,
            transport: { kind: 'held', webAudioRollingSince: () => null },
            transportMaps: FLAT_MAPS,
            sampleRate: 48_000,
        });
        answerCommand();

        await retiring;
        await superseding;

        // The engine is still retired and its instances still forgotten; only
        // the offer is withheld, because the queued start owns the session it
        // would have re-armed.
        expect(orphan.dispose).toHaveBeenCalledTimes(1);
        expect(nativeLiveGraphSession.orphanedBackend).toBeNull();
        expect(mocks.forgetRetiredPluginInstances).toHaveBeenCalledWith(['inst-1']);
        expect(offers()).toBe(0);
    });

    it('publishes the offer once the pending start has settled and left the orphan standing', async () => {
        // A start that declines — the addon that took the engine down is the
        // one the next start asks — settles without touching the orphan, so a
        // retire behind it faces the state the withholding is *not* for: no
        // start owns the session, and the musician is owed the re-arm. A count
        // that never came back down would silence every offer from here on.
        const orphan = fakeBackend();
        nativeLiveGraphSession.orphanedBackend = orphan;
        mocks.retireNativeEngine.mockResolvedValue({ outcome: 'retired', retiredInstanceIds: ['inst-1'] });

        const declining = startNativeLiveGraphSession({
            positionSeconds: 0,
            transport: { kind: 'held', webAudioRollingSince: () => null },
            transportMaps: FLAT_MAPS,
            sampleRate: 48_000,
        });
        const retiring = retireOrphanedNativeEngine();

        await declining;
        await retiring;

        expect(nativeLiveGraphSession.startsPending).toBe(0);
        expect(offers()).toBe(1);
    });

    it('sends no command when there is no orphan to retire', async () => {
        await retireOrphanedNativeEngine();

        expect(mocks.retireNativeEngine).not.toHaveBeenCalled();
        expect(offers()).toBe(0);
    });
});
