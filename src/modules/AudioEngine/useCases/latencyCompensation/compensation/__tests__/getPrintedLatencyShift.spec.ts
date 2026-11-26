import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: { value: null as { tracks: unknown[] } | null },
}));
vi.mock('#/modules/Routing/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/stores')>()),
    sidechainStore: { value: null as { routes: unknown[] } | null },
}));

import { trackStore } from '#/modules/Arrangement/stores';

import { clearAllReportedLatency } from '../externalLatencyRegistry';
import { getPrintedLatencyShift } from '../getPrintedLatencyShift';
import { reportLatency } from '../reportLatency';

const mockTrackStore = trackStore as unknown as { value: { tracks: unknown[] } | null };

function makeTrack(id: string, outputId: string, deviceIds: string[] = []) {
    return {
        id,
        outputId,
        devices: deviceIds.map((deviceId) => ({
            id: deviceId,
            name: deviceId,
            type: 'knead',
            bypassed: false,
            parameterValues: {},
        })),
        sends: [],
    };
}

describe('getPrintedLatencyShift', () => {
    beforeEach(() => {
        // The session is 250 ms deep through `deepest`. `bus` adds 100 ms downstream of `routed`, and
        // `inline` carries 40 ms of its own.
        mockTrackStore.value = {
            tracks: [
                makeTrack('plain', 'hw_out'),
                makeTrack('routed', 'bus'),
                makeTrack('bus', 'hw_out', ['bus-device']),
                makeTrack('inline', 'hw_out', ['inline-device']),
                makeTrack('deepest', 'hw_out', ['deepest-device']),
            ],
        };
        reportLatency('deepest-device', 250);
        reportLatency('bus-device', 100);
        reportLatency('inline-device', 40);
    });

    afterEach(() => {
        clearAllReportedLatency();
        mockTrackStore.value = null;
    });

    it.each([
        // Compensation plus own devices: the session depth less what lies downstream.
        { trackId: 'plain', seconds: 0.25 },
        { trackId: 'routed', seconds: 0.15 },
        { trackId: 'inline', seconds: 0.25 },
        { trackId: 'deepest', seconds: 0.25 },
        { trackId: 'bus', seconds: 0.25 },
    ])('is $seconds s for $trackId', ({ trackId, seconds }) => {
        expect(getPrintedLatencyShift(trackId)).toBeCloseTo(seconds, 10);
    });
});
