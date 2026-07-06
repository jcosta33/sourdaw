import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: { value: null as { tracks: unknown[] } | null },
}));
vi.mock('#/modules/Routing/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/stores')>()),
    sidechainStore: { value: null as { routes: unknown[] } | null },
}));
// Pin the sample rate so the sidechain-compressor latency is deterministic
// (128 / 48000 * 1000 ms) without touching the real Web Audio engine.
vi.mock('../../engineAccess/getAudioContext', () => ({
    getAudioContext: () => ({ sampleRate: 48000 }),
}));

import { trackStore } from '#/modules/Arrangement/stores';
import { sidechainStore } from '#/modules/Routing/stores';

import { externalLatencyRegistry } from '../externalLatencyRegistry';
import { getDeviceLatencyMs } from '../getDeviceLatencyMs';
import { getMaxTrackLatency } from '../getMaxTrackLatency';
import { getTrackLatency } from '../getTrackLatency';

type MutableTrackStore = { value: { tracks: unknown[] } | null };
type MutableSidechainStore = { value: { routes: unknown[] } | null };

const mockTrackStore = trackStore as unknown as MutableTrackStore;
const mockSidechainStore = sidechainStore as unknown as MutableSidechainStore;

function makeTrack(overrides: {
    id: string;
    devices?: Array<{ id: string; type: string; bypassed?: boolean }>;
    sends?: Array<{ busId: string }>;
    outputId?: string;
}) {
    return {
        id: overrides.id,
        outputId: overrides.outputId ?? 'hw_out',
        devices: (overrides.devices ?? []).map((d) => ({
            id: d.id,
            name: d.id,
            type: d.type,
            bypassed: d.bypassed ?? false,
            parameterValues: {},
        })),
        sends: (overrides.sends ?? []).map((s) => ({ busId: s.busId, level: 1, preFader: false })),
    };
}

// 128 / 48000 * 1000
const SIDECHAIN_COMP_MS = (128 / 48000) * 1000;

describe('helpers', () => {
    beforeEach(() => {
        mockTrackStore.value = null;
        mockSidechainStore.value = null;
        externalLatencyRegistry.clear();
    });

    it('should export getDeviceLatencyMs', () => {
        expect(getDeviceLatencyMs).toBeDefined();
        const time = typeof getDeviceLatencyMs;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export getMaxTrackLatency', () => {
        expect(getMaxTrackLatency).toBeDefined();
        const time = typeof getMaxTrackLatency;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export getTrackLatency', () => {
        expect(getTrackLatency).toBeDefined();
        const time = typeof getTrackLatency;
        expect(time === 'function' || time === 'object').toBe(true);
    });

    describe('getDeviceLatencyMs', () => {
        it('uses the mocked sample rate for sidechain compressor device latency', () => {
            expect(getDeviceLatencyMs('sc-1', 'builtin-sidechain-compressor')).toBeCloseTo(SIDECHAIN_COMP_MS, 6);
        });

        it('prefers externally reported device latency', () => {
            externalLatencyRegistry.set('reported-device', 12.5);

            expect(getDeviceLatencyMs('reported-device', 'builtin-eq')).toBe(12.5);
        });
    });

    describe('getTrackLatency sidechain downstream', () => {
        it('includes the sidechain target latency in the source track total', () => {
            // source -> (sidechain) -> bus track hosting a latency-bearing
            // sidechain compressor. source has no other downstream path.
            mockTrackStore.value = {
                tracks: [
                    makeTrack({ id: 'source' }),
                    makeTrack({
                        id: 'bus',
                        devices: [{ id: 'sc-1', type: 'builtin-sidechain-compressor' }],
                    }),
                ],
            };
            mockSidechainStore.value = {
                routes: [
                    {
                        id: 'r1',
                        sourceTrackId: 'source',
                        targetTrackId: 'bus',
                        targetDeviceId: 'sc-1',
                        targetParameterId: 'threshold',
                        gain: 1,
                    },
                ],
            };

            const result = getTrackLatency('source');

            // Without the sidechain walk this is 0; with it, the bus's
            // compressor latency (~2.667ms) propagates downstream.
            expect(result.totalLatencyMs).toBeCloseTo(SIDECHAIN_COMP_MS, 6);
            expect(result.deviceLatencyMs).toBe(0);
        });

        it('does not add sidechain latency when no route references the track', () => {
            mockTrackStore.value = {
                tracks: [
                    makeTrack({ id: 'source' }),
                    makeTrack({
                        id: 'bus',
                        devices: [{ id: 'sc-1', type: 'builtin-sidechain-compressor' }],
                    }),
                ],
            };
            mockSidechainStore.value = { routes: [] };

            expect(getTrackLatency('source').totalLatencyMs).toBe(0);
        });

        it('combines sidechain-downstream latency with the source own device latency', () => {
            mockTrackStore.value = {
                tracks: [
                    makeTrack({
                        id: 'source',
                        devices: [{ id: 'src-sc', type: 'builtin-sidechain-compressor' }],
                    }),
                    makeTrack({
                        id: 'bus',
                        devices: [{ id: 'sc-1', type: 'builtin-sidechain-compressor' }],
                    }),
                ],
            };
            mockSidechainStore.value = {
                routes: [
                    {
                        id: 'r1',
                        sourceTrackId: 'source',
                        targetTrackId: 'bus',
                        targetDeviceId: 'sc-1',
                        targetParameterId: 'threshold',
                        gain: 1,
                    },
                ],
            };

            const result = getTrackLatency('source');

            expect(result.deviceLatencyMs).toBeCloseTo(SIDECHAIN_COMP_MS, 6);
            // own device latency + downstream sidechain-target latency.
            expect(result.totalLatencyMs).toBeCloseTo(SIDECHAIN_COMP_MS * 2, 6);
        });

        it('does not infinite-loop on a sidechain cycle', () => {
            mockTrackStore.value = {
                tracks: [makeTrack({ id: 'a' }), makeTrack({ id: 'b' })],
            };
            mockSidechainStore.value = {
                routes: [
                    {
                        id: 'r1',
                        sourceTrackId: 'a',
                        targetTrackId: 'b',
                        targetDeviceId: 'd',
                        targetParameterId: 't',
                        gain: 1,
                    },
                    {
                        id: 'r2',
                        sourceTrackId: 'b',
                        targetTrackId: 'a',
                        targetDeviceId: 'd',
                        targetParameterId: 't',
                        gain: 1,
                    },
                ],
            };

            expect(() => getTrackLatency('a')).not.toThrow();
            expect(getTrackLatency('a').totalLatencyMs).toBe(0);
        });
    });

    describe('getMaxTrackLatency', () => {
        it('returns the largest total latency across tracks', () => {
            mockTrackStore.value = {
                tracks: [
                    makeTrack({
                        id: 'source',
                        sends: [{ busId: 'bus' }],
                    }),
                    makeTrack({
                        id: 'bus',
                        devices: [{ id: 'sc-1', type: 'builtin-sidechain-compressor' }],
                    }),
                    makeTrack({ id: 'dry' }),
                ],
            };
            mockSidechainStore.value = { routes: [] };

            expect(getMaxTrackLatency()).toBeCloseTo(SIDECHAIN_COMP_MS, 6);
        });
    });
});
