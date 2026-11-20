import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import {
    type AudioGraphApplyResult,
    type AudioGraphBackend,
    type AudioGraphStripReport,
} from '../../../models/AudioGraphBackend';
import { clearNativeChains } from '../clearNativeChains';
import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { recordNativeChainReleases } from '../recordNativeChainReleases';
import { recordNativeChains } from '../recordNativeChains';
import { replaceNativeChains } from '../replaceNativeChains';
import { restoreNativeChains } from '../restoreNativeChains';
import { startNativeGrandBoulePreviewNote } from '../startNativeGrandBoulePreviewNote';

const TARGET = { trackId: 'midi-1', deviceId: 'piano' };
const NOTE = { ...TARGET, note: 60, velocity: 0.42 };
const APPLIED: AudioGraphApplyResult = {
    acceptance: 'accepted',
    application: 'applied',
    runtimeRevision: 1,
    reports: [],
};

function reportedPiano(generation: string): AudioGraphStripReport {
    return {
        kind: 'track',
        id: TARGET.trackId,
        deviceIds: [TARGET.deviceId],
        grandBoulePreviewTargets: [{ deviceId: TARGET.deviceId, generation }],
    };
}

function armBackend() {
    const backend = {
        backendId: 'live',
        apply: vi.fn<AudioGraphBackend['apply']>().mockResolvedValue(APPLIED),
        dispose: vi.fn(),
    };
    nativeLiveGraphSession.backend = backend;
    return backend;
}

function acquireRelease(): () => void {
    const release = startNativeGrandBoulePreviewNote(NOTE);
    if (release === undefined) {
        throw new Error('expected the reported native piano to accept a queued preview');
    }
    return release;
}

describe('startNativeGrandBoulePreviewNote', () => {
    beforeEach(() => {
        replaceNativeChains([reportedPiano('first-body')]);
        nativeLiveGraphSession.carriedStripIds = new Set([TARGET.trackId]);
    });

    afterEach(async () => {
        await nativeLiveGraphSession.pending;
        clearNativeChains();
        nativeLiveGraphSession.carriedStripIds = new Set();
        nativeLiveGraphSession.backend = null;
        nativeLiveGraphSession.orphanedBackend = null;
        vi.restoreAllMocks();
    });

    it('cancels the queued onset when the gesture ends before submission', async () => {
        const backend = armBackend();
        const blockage = Promise.withResolvers<void>();
        void queueOnNativeLiveGraphSession(() => blockage.promise);

        const release = acquireRelease();
        release();
        release();
        blockage.resolve();
        await nativeLiveGraphSession.pending;

        expect(backend.apply).not.toHaveBeenCalled();
    });

    it('releases the submitted strike once on its original body after carrier handoff and uncertain onset', async () => {
        const backend = armBackend();
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const submitted = Promise.withResolvers<void>();
        const onset = Promise.withResolvers<AudioGraphApplyResult>();
        backend.apply.mockImplementationOnce(() => {
            submitted.resolve();
            return onset.promise;
        });

        const release = acquireRelease();
        await submitted.promise;
        const start = backend.apply.mock.calls[0]?.[0].commands[0];
        expect(start).toEqual({
            kind: 'start-grand-boule-preview',
            target: TARGET,
            generation: 'first-body',
            strikeId: expect.any(Number),
            note: 60,
            velocity: 0.42,
        });

        nativeLiveGraphSession.carriedStripIds = new Set();
        clearNativeChains();
        release();
        release();
        expect(backend.apply).toHaveBeenCalledOnce();

        onset.reject(new Error('bridge lost the onset response'));
        await nativeLiveGraphSession.pending;
        expect(backend.apply).toHaveBeenCalledTimes(2);
        expect(backend.apply).toHaveBeenLastCalledWith({
            schemaVersion: 1,
            commands: [
                {
                    kind: 'release-grand-boule-preview',
                    target: TARGET,
                    generation: 'first-body',
                    strikeId: start?.kind === 'start-grand-boule-preview' ? start.strikeId : undefined,
                },
            ],
        });
        expect(warn).toHaveBeenCalledExactlyOnceWith(
            '[AudioEngine] start-grand-boule-preview failed:',
            expect.objectContaining({ message: 'bridge lost the onset response' })
        );
    });

    it('drops a queued onset whose generation was replaced before it reached native', async () => {
        const backend = armBackend();
        void queueOnNativeLiveGraphSession(async () => recordNativeChains([reportedPiano('replacement-body')]));

        const release = acquireRelease();
        await nativeLiveGraphSession.pending;
        release();
        await nativeLiveGraphSession.pending;

        expect(backend.apply).not.toHaveBeenCalled();
    });

    it('leaves a held release with its original generation after a same-backend replacement', async () => {
        const backend = armBackend();
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        backend.apply.mockResolvedValueOnce(APPLIED).mockResolvedValueOnce({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'Grand Boule preview target generation is stale',
        });
        const release = acquireRelease();
        await nativeLiveGraphSession.pending;

        recordNativeChains([reportedPiano('replacement-body')]);
        release();
        await nativeLiveGraphSession.pending;

        expect(backend.apply).toHaveBeenCalledTimes(2);
        expect(backend.apply).toHaveBeenLastCalledWith({
            schemaVersion: 1,
            commands: [
                {
                    kind: 'release-grand-boule-preview',
                    target: TARGET,
                    generation: 'first-body',
                    strikeId: expect.any(Number),
                },
            ],
        });
        expect(warn).toHaveBeenCalledExactlyOnceWith(
            '[AudioEngine] release-grand-boule-preview refused: Grand Boule preview target generation is stale'
        );
    });

    it('sends no release after the original backend has retired', async () => {
        const original = armBackend();
        const release = acquireRelease();
        await nativeLiveGraphSession.pending;

        const successor = armBackend();
        replaceNativeChains([reportedPiano('successor-body')]);
        release();
        await nativeLiveGraphSession.pending;

        expect(original.apply).toHaveBeenCalledOnce();
        expect(successor.apply).not.toHaveBeenCalled();
    });

    it('allocates separate strikes for the same pitch and releases them in gesture order', async () => {
        const backend = armBackend();
        const first = acquireRelease();
        const second = acquireRelease();
        await nativeLiveGraphSession.pending;

        second();
        first();
        await nativeLiveGraphSession.pending;

        const [firstOnset, secondOnset, secondRelease, firstRelease] = backend.apply.mock.calls.map(
            ([batch]) => batch.commands[0]
        );
        if (firstOnset?.kind !== 'start-grand-boule-preview' || secondOnset?.kind !== 'start-grand-boule-preview') {
            throw new Error('expected two preview onsets');
        }
        expect(firstOnset.strikeId).toBeGreaterThan(0);
        expect(secondOnset.strikeId).toBeGreaterThan(firstOnset.strikeId);
        expect(secondOnset.strikeId).toBeLessThanOrEqual(0xffff_ffff);
        expect(secondRelease).toMatchObject({ kind: 'release-grand-boule-preview', strikeId: secondOnset.strikeId });
        expect(firstRelease).toMatchObject({ kind: 'release-grand-boule-preview', strikeId: firstOnset.strikeId });
    });

    it('refuses a projected chain and restores the old generation only when its graph survives', async () => {
        const backend = armBackend();
        const previous = {
            nativeChainByStripId: nativeLiveGraphSession.nativeChainByStripId,
            grandBoulePreviewTargetsByStripId: nativeLiveGraphSession.grandBoulePreviewTargetsByStripId,
        };
        replaceNativeChains([{ kind: 'track', id: TARGET.trackId, deviceIds: [TARGET.deviceId] }]);
        expect(startNativeGrandBoulePreviewNote(NOTE)).toBeUndefined();

        restoreNativeChains(previous);
        acquireRelease();
        await nativeLiveGraphSession.pending;
        expect(backend.apply).toHaveBeenCalledExactlyOnceWith({
            schemaVersion: 1,
            commands: [expect.objectContaining({ kind: 'start-grand-boule-preview', generation: 'first-body' })],
        });

        await recordNativeChainReleases([{ id: TARGET.trackId, deviceIds: [] }]);
        expect(nativeLiveGraphSession.grandBoulePreviewTargetsByStripId.has(TARGET.trackId)).toBe(false);
        expect(startNativeGrandBoulePreviewNote(NOTE)).toBeUndefined();
    });
});
