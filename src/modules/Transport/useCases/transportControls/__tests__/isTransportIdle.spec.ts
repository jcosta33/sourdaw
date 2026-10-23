import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTransportState } from '../../../models/TransportState';
import { transportStore } from '../../../stores/transportStore';
import { isTransportIdle } from '../isTransportIdle';
import { recordingLifecycle } from '../recordingLifecycle';

describe('isTransportIdle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        transportStore.set(defaultTransportState);
        recordingLifecycle.cancelPendingRecordingStart();
        recordingLifecycle.setCountInTimerId(null);
    });

    afterEach(() => {
        recordingLifecycle.cancelPendingRecordingStart();
        recordingLifecycle.setCountInTimerId(null);
        transportStore.set(defaultTransportState);
        vi.useRealTimers();
    });

    it('is idle when nothing is rolling and no recording start is pending', () => {
        expect(isTransportIdle()).toBe(true);
    });

    it('is idle when no transport state has been published', () => {
        transportStore.clear();

        expect(transportStore.value).toBeNull();
        expect(isTransportIdle()).toBe(true);
    });

    it('is not idle while playing', () => {
        transportStore.set({ ...defaultTransportState, isPlaying: true });

        expect(isTransportIdle()).toBe(false);
    });

    it('is not idle while recording', () => {
        transportStore.set({ ...defaultTransportState, isRecording: true });

        expect(isTransportIdle()).toBe(false);
    });

    it('is not idle while a recording start waits on its token', () => {
        recordingLifecycle.beginPendingRecordingStart();

        expect(isTransportIdle()).toBe(false);
    });

    it('is not idle while a count-in timer is pending', () => {
        recordingLifecycle.setCountInTimerId(setTimeout(() => undefined, 1000));

        expect(isTransportIdle()).toBe(false);
    });

    // A user's Pause or Stop writes an idle transport at once and awaits the
    // recorder's flush and the take's commit afterwards.
    it('is not idle while a stop is still closing a recording, and is idle once it has settled', async () => {
        const closing = Promise.withResolvers<void>();
        recordingLifecycle.trackClosing(closing.promise);

        expect(isTransportIdle()).toBe(false);

        closing.resolve();
        await recordingLifecycle.waitForClosing();
        expect(isTransportIdle()).toBe(true);
    });

    it('is idle once a closing stop has settled although nobody ever waited for it', async () => {
        const closing = Promise.withResolvers<void>();
        recordingLifecycle.trackClosing(closing.promise);

        closing.resolve();

        await vi.waitFor(() => expect(isTransportIdle()).toBe(true));
    });

    it('is idle once a closing stop has rejected although nobody ever waited for it', async () => {
        const closing = Promise.withResolvers<void>();
        recordingLifecycle.trackClosing(closing.promise);

        closing.reject(new Error('recorder flush failed'));

        await vi.waitFor(() => expect(isTransportIdle()).toBe(true));
    });

    it('is idle again after a closing stop rejects', async () => {
        const closing = Promise.withResolvers<void>();
        recordingLifecycle.trackClosing(closing.promise);

        closing.reject(new Error('recorder flush failed'));
        await recordingLifecycle.waitForClosing();

        expect(isTransportIdle()).toBe(true);
    });

    it('is not idle while a take commit started by the scheduler is in flight', async () => {
        const commit = Promise.withResolvers<void>();
        recordingLifecycle.trackCommit(commit.promise);

        expect(isTransportIdle()).toBe(false);

        commit.resolve();
        await recordingLifecycle.waitForCommits();
        expect(isTransportIdle()).toBe(true);
    });

    it('is idle once a take commit has settled although nobody ever waited for it', async () => {
        const commit = Promise.withResolvers<void>();
        recordingLifecycle.trackCommit(commit.promise);

        commit.resolve();
        await vi.waitFor(() => expect(isTransportIdle()).toBe(true));
    });
});
