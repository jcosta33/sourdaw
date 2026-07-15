import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { recordingLifecycle } from '../recordingLifecycle';

describe('recording lifecycle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        recordingLifecycle.cancelPendingRecordingStart();
        recordingLifecycle.setCountInTimerId(null);
    });

    afterEach(() => {
        recordingLifecycle.cancelPendingRecordingStart();
        recordingLifecycle.setCountInTimerId(null);
        vi.useRealTimers();
    });

    it('should update the shared count-in timer handle', () => {
        const timerId = setTimeout(() => {}, 1000);

        recordingLifecycle.setCountInTimerId(timerId);
        expect(recordingLifecycle.countInTimerId).toBe(timerId);
        expect(recordingLifecycle.hasPendingRecordingStart()).toBe(true);

        recordingLifecycle.setCountInTimerId(null);
        expect(recordingLifecycle.countInTimerId).toBeNull();
        expect(recordingLifecycle.hasPendingRecordingStart()).toBe(false);
    });

    it('uses owner tokens to prevent a canceled start from completing', () => {
        const first = recordingLifecycle.beginPendingRecordingStart();

        expect(recordingLifecycle.hasPendingRecordingStart()).toBe(true);
        expect(recordingLifecycle.ownsPendingRecordingStart(first)).toBe(true);

        recordingLifecycle.cancelPendingRecordingStart();
        expect(recordingLifecycle.completePendingRecordingStart(first)).toBe(false);

        const second = recordingLifecycle.beginPendingRecordingStart();
        expect(second).not.toBe(first);
        expect(recordingLifecycle.completePendingRecordingStart(second)).toBe(true);
        expect(recordingLifecycle.hasPendingRecordingStart()).toBe(false);
    });
});
