/**
 * What an unload's released strip reports do to the session's record of what
 * the engine's chains hold (#3793), and where that write lands in the session
 * order (#3888).
 *
 * Unlike `recordNativeChains`, an unload never creates a strip — it only ever
 * releases chain entries the session's own topology batch already built — so
 * a report naming a strip this session never built has nothing to narrow.
 * The write queues on the native live graph session: an unload reply returns
 * after unbounded third-party teardown, and a report captured before a
 * concurrent mirror batch commits must not be applied after that batch's own
 * report.
 */

import { describe, expect, it } from 'vitest';

import { type AudioGraphStripReport } from '../../../models/AudioGraphBackend';
import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { recordNativeChainReleases } from '../recordNativeChainReleases';

describe('recordNativeChainReleases', () => {
    it('narrows a held strip to the chain the release left it with', async () => {
        nativeLiveGraphSession.nativeChainByStripId = new Map([['audio-1', ['comp', 'proq', 'limiter']]]);

        await recordNativeChainReleases([{ id: 'audio-1', deviceIds: ['comp', 'limiter'] }]);

        expect(nativeLiveGraphSession.nativeChainByStripId.get('audio-1')).toEqual(['comp', 'limiter']);
    });

    it('ignores a report naming a strip this session never built', async () => {
        const before = new Map([['audio-1', ['comp', 'limiter']]]);
        nativeLiveGraphSession.nativeChainByStripId = before;

        await recordNativeChainReleases([{ id: 'audio-9', deviceIds: [] }]);

        expect(nativeLiveGraphSession.nativeChainByStripId).toBe(before);
        expect(nativeLiveGraphSession.nativeChainByStripId.size).toBe(1);
        expect(nativeLiveGraphSession.nativeChainByStripId.has('audio-9')).toBe(false);
    });

    it('does nothing with an empty report list', async () => {
        const before = new Map([['audio-1', ['comp']]]);
        nativeLiveGraphSession.nativeChainByStripId = before;

        await recordNativeChainReleases([]);

        expect(nativeLiveGraphSession.nativeChainByStripId).toBe(before);
    });

    it('narrows only the held strips among a mixed report list', async () => {
        nativeLiveGraphSession.nativeChainByStripId = new Map([
            ['audio-1', ['comp', 'proq']],
            ['audio-2', ['eq']],
        ]);
        const reports: AudioGraphStripReport[] = [
            { kind: 'track', id: 'audio-1', deviceIds: ['comp'] },
            { kind: 'track', id: 'audio-9', deviceIds: ['ghost'] },
        ];

        await recordNativeChainReleases(reports);

        expect(nativeLiveGraphSession.nativeChainByStripId.get('audio-1')).toEqual(['comp']);
        expect(nativeLiveGraphSession.nativeChainByStripId.get('audio-2')).toEqual(['eq']);
        expect(nativeLiveGraphSession.nativeChainByStripId.has('audio-9')).toBe(false);
    });

    it('takes its place behind a mirror batch already in flight instead of being re-widened by it', async () => {
        nativeLiveGraphSession.nativeChainByStripId = new Map([['audio-1', ['comp', 'proq', 'limiter']]]);
        let resumeBatch!: () => void;
        const inFlight = new Promise<void>((resolve) => {
            resumeBatch = resolve;
        });
        // A mirror batch already queued when the unload reply lands; its snapshot
        // was taken before the unload and still carries the released devices.
        const batch = queueOnNativeLiveGraphSession(async () => {
            await inFlight;
            const next = new Map(nativeLiveGraphSession.nativeChainByStripId);
            next.set('audio-1', ['comp', 'proq', 'limiter', 'delayed-device']);
            nativeLiveGraphSession.nativeChainByStripId = next;
        });

        // The unload reply arrives while the batch is mid-flight: applied out of
        // order, its narrow write would be overwritten by the batch's stale
        // snapshot, re-widening the mirror with devices the engine released.
        const settled = recordNativeChainReleases([{ id: 'audio-1', deviceIds: ['comp'] }]);
        resumeBatch();
        await batch;
        await settled;

        expect(nativeLiveGraphSession.nativeChainByStripId.get('audio-1')).toEqual(['comp']);
    });
});
