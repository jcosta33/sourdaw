/**
 * #4873 — lifecycle note-off ownership at the routing seam.
 *
 * When a Yeast worker retires (projection change, panic) it emits note-offs for
 * voices it started. Those offs must release the instrument control the voice
 * was captured on, not whichever node the track hosts now: swapping an
 * instrument mid-generated-note used to strand the original voice and disturb
 * a same-pitch successor on the replacement. `releaseCapturedYeastLifecycleVoices`
 * resolves each identity through the captured-owner registry and returns only
 * the identityless leftovers the current-node compat route still delivers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pendingYeastRelease } from '../pendingYeastRelease';
import { releaseCapturedYeastLifecycleVoices } from '../routeYeastLifecycleNoteOff';

const TRACK = 'track-1';
const ROUTE = `${TRACK}:yeast-1`;

beforeEach(() => {
    // The registry is module state; a full release empties every population
    // (active registered voices and pending begin snapshots) between cases.
    pendingYeastRelease.releaseAllPending();
});

describe('releaseCapturedYeastLifecycleVoices', () => {
    it.each(['fermenter', 'grand-boule', 'levain'] as const)(
        'releases the captured %s control a generated voice was started on',
        (instrument) => {
            const capturedRelease = vi.fn();
            pendingYeastRelease.registerVoice(ROUTE, TRACK, `${instrument}:v1`, 60, 0, capturedRelease);

            const leftovers = releaseCapturedYeastLifecycleVoices(TRACK, [
                { channel: 0, note: 60, noteInstanceId: `${instrument}:v1`, sampleFrame: 4096 },
            ]);

            expect(leftovers).toEqual([]);
            expect(capturedRelease).toHaveBeenCalledExactlyOnceWith(4096, 0);
        }
    );

    it('releases the original owner and leaves a same-pitch successor on the replacement untouched', () => {
        const originalRelease = vi.fn();
        const successorRelease = vi.fn();
        pendingYeastRelease.registerVoice(ROUTE, TRACK, 'voice-old', 60, 0, originalRelease);
        // The replacement started its own same-pitch voice after the swap.
        pendingYeastRelease.registerVoice(ROUTE, TRACK, 'voice-new', 60, 0, successorRelease);

        const leftovers = releaseCapturedYeastLifecycleVoices(TRACK, [
            { channel: 0, note: 60, noteInstanceId: 'voice-old', sampleFrame: 512 },
        ]);

        expect(leftovers).toEqual([]);
        expect(originalRelease).toHaveBeenCalledExactlyOnceWith(512, 0);
        expect(successorRelease).not.toHaveBeenCalled();

        // The successor's own lifecycle off still releases it through its owner.
        const successorLeftovers = releaseCapturedYeastLifecycleVoices(TRACK, [
            { channel: 0, note: 60, noteInstanceId: 'voice-new', sampleFrame: 1024 },
        ]);
        expect(successorLeftovers).toEqual([]);
        expect(successorRelease).toHaveBeenCalledExactlyOnceWith(1024, 0);
    });

    it('drops an instance-keyed off whose voice is gone instead of routing it to the current node', () => {
        const capturedRelease = vi.fn();
        pendingYeastRelease.registerVoice(ROUTE, TRACK, 'voice-a', 60, 0, capturedRelease);

        expect(
            releaseCapturedYeastLifecycleVoices(TRACK, [{ channel: 0, note: 60, noteInstanceId: 'voice-a' }])
        ).toEqual([]);
        // A repeat of the same lifecycle off is idempotent: the voice is gone,
        // so the off is dropped — it must never fall through to the current
        // node and disturb a successor.
        expect(
            releaseCapturedYeastLifecycleVoices(TRACK, [{ channel: 0, note: 60, noteInstanceId: 'voice-a' }])
        ).toEqual([]);
        expect(capturedRelease).toHaveBeenCalledTimes(1);
    });

    it('drops an instance-keyed off scoped to another channel or pitch', () => {
        const capturedRelease = vi.fn();
        pendingYeastRelease.registerVoice(ROUTE, TRACK, 'voice-a', 60, 1, capturedRelease);

        expect(
            releaseCapturedYeastLifecycleVoices(TRACK, [
                { channel: 0, note: 60, noteInstanceId: 'voice-a' },
                { channel: 1, note: 62, noteInstanceId: 'voice-a' },
            ])
        ).toEqual([]);
        expect(capturedRelease).not.toHaveBeenCalled();
    });

    it('releases a pending captured voice for an identityless off', () => {
        const capturedRelease = vi.fn();
        // The source note's release snapshot: pitch-keyed releases waiting for
        // their note-off, captured on the instrument that voiced them.
        pendingYeastRelease.begin(ROUTE, new Map([[60, capturedRelease]]), TRACK, 0);

        const leftovers = releaseCapturedYeastLifecycleVoices(TRACK, [{ channel: 0, note: 60, sampleFrame: 256 }]);

        expect(leftovers).toEqual([]);
        expect(capturedRelease).toHaveBeenCalledExactlyOnceWith(256, 0);
    });

    it('returns identityless offs with no captured owner for the current-node compat route', () => {
        const leftovers = releaseCapturedYeastLifecycleVoices(TRACK, [
            { channel: 0, note: 60, sampleFrame: 128 },
            { channel: 0, note: 64 },
        ]);

        expect(leftovers).toEqual([
            { channel: 0, note: 60, sampleFrame: 128 },
            { channel: 0, note: 64 },
        ]);
    });

    it('routes a reset-released registry back to the compat route for identityless offs only', () => {
        const capturedRelease = vi.fn();
        pendingYeastRelease.registerVoice(ROUTE, TRACK, 'voice-a', 60, 0, capturedRelease);
        pendingYeastRelease.begin(ROUTE, new Map([[62, capturedRelease]]), TRACK, 0);

        // Reset / panic releases everything the registry holds.
        pendingYeastRelease.releaseAllPending();
        expect(capturedRelease).toHaveBeenCalledTimes(2);

        const leftovers = releaseCapturedYeastLifecycleVoices(TRACK, [
            { channel: 0, note: 60, noteInstanceId: 'voice-a' },
            { channel: 0, note: 62 },
        ]);

        // The instance-keyed off is a repeat: dropped. The identityless off has
        // no captured owner left: compat route.
        expect(leftovers).toEqual([{ channel: 0, note: 62 }]);
        expect(capturedRelease).toHaveBeenCalledTimes(2);
    });

    it('keeps identityless captures scoped to their track', () => {
        const capturedRelease = vi.fn();
        pendingYeastRelease.begin(`${TRACK}:yeast-1`, new Map([[60, capturedRelease]]), TRACK, 0);

        const otherTrackLeftovers = releaseCapturedYeastLifecycleVoices('track-2', [{ channel: 0, note: 60 }]);
        expect(otherTrackLeftovers).toEqual([{ channel: 0, note: 60 }]);
        expect(capturedRelease).not.toHaveBeenCalled();

        const ownTrackLeftovers = releaseCapturedYeastLifecycleVoices(TRACK, [{ channel: 0, note: 60 }]);
        expect(ownTrackLeftovers).toEqual([]);
        expect(capturedRelease).toHaveBeenCalledTimes(1);
    });
});
