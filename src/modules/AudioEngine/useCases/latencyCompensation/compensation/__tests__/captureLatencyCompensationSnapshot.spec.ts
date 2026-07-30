import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type TestState = {
    trackStoreReads: number;
    sidechainStoreReads: number;
    trackValue: { tracks: unknown[] } | null;
    sidechainValue: { routes: unknown[] } | null;
    sampleRate: number;
    audioContextReads: number;
};

const testState = vi.hoisted((): TestState => ({
    trackStoreReads: 0,
    sidechainStoreReads: 0,
    trackValue: { tracks: [] as unknown[] },
    sidechainValue: { routes: [] as unknown[] },
    sampleRate: 48_000,
    audioContextReads: 0,
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: {
        get value() {
            testState.trackStoreReads += 1;
            return testState.trackValue;
        },
    },
}));

vi.mock('#/modules/Routing/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/stores')>()),
    sidechainStore: {
        get value() {
            testState.sidechainStoreReads += 1;
            return testState.sidechainValue;
        },
    },
}));

vi.mock('../../../engineAccess/getAudioContext', () => ({
    getAudioContext: () => {
        testState.audioContextReads += 1;
        return { sampleRate: testState.sampleRate };
    },
}));

vi.mock('../getDeviceLatencyMs', () => ({
    getDeviceLatencyMs: vi.fn((deviceId: string, _deviceType: string, sampleRate?: number) => {
        if (deviceId === 'slow-device') {
            return 40;
        }
        if (deviceId === 'bus-device') {
            return 10;
        }
        if (deviceId === 'cycle-a') {
            return 10;
        }
        if (deviceId === 'cycle-b') {
            return 20;
        }
        if (deviceId === 'sample-rate-device') {
            return (128 / (sampleRate ?? 48_000)) * 1000;
        }
        return 0;
    }),
}));

import { captureLatencyCompensationSnapshot } from '../captureLatencyCompensationSnapshot';
import { externalLatencyRegistry } from '../externalLatencyRegistry';
import { getDeviceLatencyMs } from '../getDeviceLatencyMs';

function makeTrack(input: {
    id: string;
    deviceId?: string;
    deviceType?: string;
    outputId?: string;
    sends?: { busId: string }[];
}) {
    return {
        id: input.id,
        kind: 'audio',
        outputId: input.outputId ?? 'hw_out',
        devices: input.deviceId
            ? [
                  {
                      id: input.deviceId,
                      name: input.deviceId,
                      type: input.deviceType ?? 'external-plugin',
                      bypassed: false,
                      parameterValues: {},
                  },
              ]
            : [],
        sends: input.sends ?? [],
    };
}

describe('captureLatencyCompensationSnapshot', () => {
    beforeEach(() => {
        testState.trackStoreReads = 0;
        testState.sidechainStoreReads = 0;
        testState.sampleRate = 48_000;
        testState.audioContextReads = 0;
        testState.trackValue = {
            tracks: [
                makeTrack({ id: 'slow', deviceId: 'slow-device', outputId: 'bus' }),
                makeTrack({ id: 'dry', outputId: 'bus' }),
                makeTrack({ id: 'bus', deviceId: 'bus-device' }),
            ],
        };
        testState.sidechainValue = {
            routes: [
                {
                    id: 'route-1',
                    sourceTrackId: 'slow',
                    targetTrackId: 'dry',
                    targetDeviceId: 'slow-device',
                    enabled: true,
                    gain: 1,
                },
            ],
        };
        vi.mocked(getDeviceLatencyMs).mockClear();
    });

    afterEach(() => {
        externalLatencyRegistry.clear();
    });

    it('reuses one resolved projection across unchanged scheduler ticks', () => {
        const snapshot = captureLatencyCompensationSnapshot();

        expect(snapshot.getCompensationDelay('dry')).toBeCloseTo(0.04, 10);
        expect(snapshot.getCompensationDelay('dry')).toBeCloseTo(0.04, 10);
        expect(
            snapshot.getSidechainKeyDelay({
                sourceTrackId: 'dry',
                targetTrackId: 'slow',
                targetDeviceId: 'slow-device',
            })
        ).toBe(0);

        expect(captureLatencyCompensationSnapshot()).toBe(snapshot);
        expect(captureLatencyCompensationSnapshot()).toBe(snapshot);
        expect(testState.trackStoreReads).toBe(3);
        expect(testState.sidechainStoreReads).toBe(3);
        expect(getDeviceLatencyMs).toHaveBeenCalledTimes(2);
        expect(getDeviceLatencyMs).toHaveBeenNthCalledWith(1, 'slow-device', 'external-plugin');
        expect(getDeviceLatencyMs).toHaveBeenNthCalledWith(2, 'bus-device', 'external-plugin');
    });

    it('keeps one tick coherent while the next snapshot observes a latency change', () => {
        const firstTick = captureLatencyCompensationSnapshot();

        testState.trackValue = {
            tracks: [
                makeTrack({ id: 'slow', outputId: 'bus' }),
                makeTrack({ id: 'dry', outputId: 'bus' }),
                makeTrack({ id: 'bus', deviceId: 'bus-device' }),
            ],
        };
        const nextTick = captureLatencyCompensationSnapshot();

        expect(firstTick.getCompensationDelay('dry')).toBeCloseTo(0.04, 10);
        expect(nextTick.getCompensationDelay('dry')).toBe(0);
        expect(testState.trackStoreReads).toBe(2);
        expect(testState.sidechainStoreReads).toBe(2);
    });

    it('invalidates the projection when a native plugin reports new latency', () => {
        const beforeReport = captureLatencyCompensationSnapshot();

        externalLatencyRegistry.set('native-device', 25);
        const afterReport = captureLatencyCompensationSnapshot();

        expect(afterReport).not.toBe(beforeReport);
        expect(getDeviceLatencyMs).toHaveBeenCalledTimes(4);
    });

    it('returns an empty projection without resolving a device or audio context', () => {
        testState.trackValue = { tracks: [] };
        testState.sidechainValue = { routes: [] };

        const snapshot = captureLatencyCompensationSnapshot();

        expect(snapshot.getTrackLatency('missing')).toEqual({
            trackId: 'missing',
            deviceLatencyMs: 0,
            totalLatencyMs: 0,
        });
        expect(snapshot.getMaxTrackLatency()).toBe(0);
        expect(getDeviceLatencyMs).not.toHaveBeenCalled();
        expect(testState.audioContextReads).toBe(0);
    });

    it('does not reuse a live-project projection after both stores become absent', () => {
        const liveProject = captureLatencyCompensationSnapshot();
        testState.trackValue = null;
        testState.sidechainValue = null;

        const noProject = captureLatencyCompensationSnapshot();

        expect(noProject).not.toBe(liveProject);
        expect(noProject.getMaxTrackLatency()).toBe(0);
    });

    it('invalidates sample-rate-dependent latency without initializing an empty project', () => {
        testState.trackValue = {
            tracks: [
                makeTrack({
                    id: 'sidechain',
                    deviceId: 'sample-rate-device',
                    deviceType: 'builtin-sidechain-compressor',
                }),
            ],
        };
        const at48Khz = captureLatencyCompensationSnapshot();

        testState.sampleRate = 96_000;
        const at96Khz = captureLatencyCompensationSnapshot();

        expect(at48Khz.getTrackLatency('sidechain').deviceLatencyMs).toBeCloseTo((128 / 48_000) * 1000, 10);
        expect(at96Khz.getTrackLatency('sidechain').deviceLatencyMs).toBeCloseTo((128 / 96_000) * 1000, 10);
        expect(at96Khz).not.toBe(at48Khz);
        expect(testState.audioContextReads).toBe(3);
    });

    it('does not cache partial latency from a corrupt routing cycle', () => {
        testState.trackValue = {
            tracks: [
                makeTrack({ id: 'a', deviceId: 'cycle-a', outputId: 'b' }),
                makeTrack({ id: 'b', deviceId: 'cycle-b', outputId: 'a' }),
            ],
        };
        testState.sidechainValue = { routes: [] };

        const snapshot = captureLatencyCompensationSnapshot();

        expect(snapshot.getTrackLatency('a').totalLatencyMs).toBe(30);
        expect(snapshot.getTrackLatency('b').totalLatencyMs).toBe(30);
        expect(snapshot.getCompensationDelay('a')).toBe(0);
        expect(snapshot.getCompensationDelay('b')).toBe(0);
    });
});
