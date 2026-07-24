import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as subject from '../getSynthParamsForTrack';

const mocks = vi.hoisted(() => ({
    getTrackById: vi.fn<(id: string) => { devices: unknown[] } | undefined>(),
    // Deterministic stub: the module loads the default from getSynthParamsFromDevices([])
    // at import time, so the stub must be meaningful before any beforeEach runs.
    getSynthParamsFromDevices: vi.fn<(devices: unknown[]) => { marker: string }>((devices) => ({
        marker: `devices:${JSON.stringify(devices)}`,
    })),
}));

vi.mock('../getTrackById', () => ({
    getTrackById: (id: string) => mocks.getTrackById(id),
}));

vi.mock('#/modules/Synth/useCases', () => ({
    getSynthParamsFromDevices: (devices: unknown[]) => mocks.getSynthParamsFromDevices(devices),
}));

describe('getSynthParamsForTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Re-arm the default implementation after clearAllMocks resets call history
        // (the function itself survives, but keep the behaviour explicit).
        mocks.getSynthParamsFromDevices.mockImplementation((devices) => ({
            marker: `devices:${JSON.stringify(devices)}`,
        }));
    });

    it('returns params derived from the track devices when the track exists', () => {
        mocks.getTrackById.mockReturnValue({ devices: ['a', 'b'] });

        expect(subject.getSynthParamsForTrack('t1')).toEqual({ marker: 'devices:["a","b"]' });
    });

    it('returns the empty-device default params when the track is missing', () => {
        mocks.getTrackById.mockReturnValue(undefined);

        // The default is the params computed from an empty device list.
        expect(subject.getSynthParamsForTrack('ghost')).toEqual({ marker: 'devices:[]' });
    });

    it('returns a fresh object instance for a missing track (callers may mutate safely)', () => {
        mocks.getTrackById.mockReturnValue(undefined);

        const alpha = subject.getSynthParamsForTrack('ghost');
        const beta = subject.getSynthParamsForTrack('ghost');
        expect(alpha).toEqual(beta);
        expect(alpha).not.toBe(beta);
    });
});
