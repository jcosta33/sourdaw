import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTransportState, type TransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { isTransportIdle } from '../isTransportIdle';
import { recordingLifecycle } from '../recordingLifecycle';

vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));

function transportWith(overrides: Partial<TransportState>): void {
    vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, ...overrides });
}

describe('isTransportIdle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        recordingLifecycle.cancelPendingRecordingStart();
        recordingLifecycle.setCountInTimerId(null);
        transportWith({});
    });

    afterEach(() => {
        recordingLifecycle.cancelPendingRecordingStart();
        recordingLifecycle.setCountInTimerId(null);
        vi.useRealTimers();
    });

    it('is idle when nothing is rolling, recording or starting', () => {
        expect(isTransportIdle()).toBe(true);
    });

    it('is idle before any transport state exists', () => {
        vi.mocked(getTransportState).mockReturnValue(null);

        expect(isTransportIdle()).toBe(true);
    });

    it('is not idle while playing', () => {
        transportWith({ isPlaying: true });

        expect(isTransportIdle()).toBe(false);
    });

    it('is not idle while recording', () => {
        transportWith({ isRecording: true });

        expect(isTransportIdle()).toBe(false);
    });

    it('is not idle while a recording start is still opening its capture', () => {
        recordingLifecycle.beginPendingRecordingStart();

        expect(isTransportIdle()).toBe(false);
    });

    it('is not idle while a count-in is running', () => {
        recordingLifecycle.setCountInTimerId(setTimeout(() => {}, 1000));

        expect(isTransportIdle()).toBe(false);
    });
});
