import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// MIDI owns the overdub landings; Transport reads them through its use cases.
const overdub = vi.hoisted(() => {
    const state = { landing: null as Promise<void> | null, settled: 0 };
    return {
        state,
        land(landing: Promise<void>): void {
            const settle = (): void => {
                state.landing = null;
                state.settled += 1;
            };
            state.landing = landing.then(settle, settle);
        },
    };
});

vi.mock('#/modules/MIDI/useCases', () => ({
    isOverdubLanding: () => overdub.state.landing !== null,
    countSettledOverdubPasses: () => overdub.state.settled,
    waitForOverdubLanding: async () => {
        await overdub.state.landing;
    },
}));

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

    // An overdub pass writes its rows after the falling edge, behind the snapshot transaction queue.
    it('is not idle while an overdub pass is still landing, and is idle once it has landed or been refused', async () => {
        const landed = Promise.withResolvers<void>();
        overdub.land(landed.promise);
        expect(isTransportIdle()).toBe(false);
        landed.resolve();
        await vi.waitFor(() => expect(isTransportIdle()).toBe(true));

        const refused = Promise.withResolvers<void>();
        overdub.land(refused.promise);
        expect(isTransportIdle()).toBe(false);
        refused.reject(new Error('refused'));
        await vi.waitFor(() => expect(isTransportIdle()).toBe(true));
    });

    it('is idle once a take commit has settled although nobody ever waited for it', async () => {
        const commit = Promise.withResolvers<void>();
        recordingLifecycle.trackCommit(commit.promise);

        commit.resolve();
        await vi.waitFor(() => expect(isTransportIdle()).toBe(true));
    });
});
