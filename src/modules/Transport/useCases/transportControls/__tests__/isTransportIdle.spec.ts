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
});
