import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: { value: null as { tracks: unknown[] } | null },
}));
vi.mock('#/modules/Routing/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/stores')>()),
    sidechainStore: { value: null as { routes: unknown[] } | null },
}));
// Pin the rate so the sidechain compressor's one-block latency is exactly
// 128/48000 s and no context-rate drift leaks into the expected totals.
vi.mock('../../../engineAccess/getAudioContext', () => ({
    getAudioContext: () => ({ sampleRate: 48000 }),
}));

import { trackStore } from '#/modules/Arrangement/stores';
import { sidechainStore } from '#/modules/Routing/stores';

import { externalLatencyRegistry } from '../externalLatencyRegistry';
import { getCompensationDelay } from '../getCompensationDelay';
import { getSidechainKeyDelay } from '../getSidechainKeyDelay';
import { getTrackLatency } from '../getTrackLatency';
import { DYNAMICS_COMPRESSOR_LOOKAHEAD_MS, WORKLET_BLOCK_SIZE } from '../helpers';

type MutableStore<T> = { value: T | null };
const mockTrackStore = trackStore as unknown as MutableStore<{ tracks: unknown[] }>;
const mockSidechainStore = sidechainStore as unknown as MutableStore<{ routes: unknown[] }>;

type DeviceInput = { id: string; type?: string; bypassed?: boolean };

function makeDevice(device: DeviceInput) {
    return {
        id: device.id,
        name: device.id,
        // A WASM built-in, because that is what Web Audio still hosts and still
        // delays for. An `external-plugin` device is a pass-through here and
        // costs this graph nothing (#3564), so a latency hung on one could never
        // move the figures these gaps are about.
        type: device.type ?? 'knead',
        bypassed: device.bypassed ?? false,
        parameterValues: {},
    };
}

function makeTrack(overrides: { id: string; devices?: DeviceInput[]; outputId?: string }) {
    return {
        id: overrides.id,
        kind: 'audio',
        outputId: overrides.outputId ?? 'hw_out',
        devices: (overrides.devices ?? []).map(makeDevice),
        sends: [],
    };
}

const SC_BLOCK_MS = (WORKLET_BLOCK_SIZE / 48_000) * 1000;

describe('RT-6 — the built-in DynamicsCompressor lookahead reaches the compensation surface', () => {
    beforeEach(() => {
        mockTrackStore.value = null;
        mockSidechainStore.value = null;
        externalLatencyRegistry.clear();
    });

    it('counts the built-in compressor lookahead as track latency instead of zero', () => {
        mockTrackStore.value = {
            tracks: [
                makeTrack({ id: 'vox', devices: [{ id: 'dev-comp', type: 'builtin-compressor' }] }),
                makeTrack({ id: 'drums' }),
            ],
        };

        expect(getTrackLatency('vox')).toEqual({
            trackId: 'vox',
            deviceLatencyMs: DYNAMICS_COMPRESSOR_LOOKAHEAD_MS,
            totalLatencyMs: DYNAMICS_COMPRESSOR_LOOKAHEAD_MS,
        });
        // The uncompensated neighbour is the one that has to move back.
        expect(getCompensationDelay('drums')).toBeCloseTo(DYNAMICS_COMPRESSOR_LOOKAHEAD_MS / 1000, 10);
        expect(getCompensationDelay('vox')).toBe(0);
    });

    it('counts the limiter and de-esser lookahead, and sums them along one chain', () => {
        mockTrackStore.value = {
            tracks: [
                makeTrack({
                    id: 'mix-bus',
                    devices: [
                        { id: 'dev-limit', type: 'builtin-limiter' },
                        { id: 'dev-dess', type: 'builtin-deesser' },
                    ],
                }),
                makeTrack({ id: 'drums' }),
            ],
        };

        expect(getTrackLatency('mix-bus').deviceLatencyMs).toBeCloseTo(2 * DYNAMICS_COMPRESSOR_LOOKAHEAD_MS, 10);
        expect(getCompensationDelay('drums')).toBeCloseTo((2 * DYNAMICS_COMPRESSOR_LOOKAHEAD_MS) / 1000, 10);
    });

    it('drops the lookahead again when the compressor is bypassed', () => {
        mockTrackStore.value = {
            tracks: [
                makeTrack({ id: 'vox', devices: [{ id: 'dev-comp', type: 'builtin-compressor', bypassed: true }] }),
                makeTrack({ id: 'drums' }),
            ],
        };

        expect(getTrackLatency('vox').totalLatencyMs).toBe(0);
        expect(getCompensationDelay('drums')).toBe(0);
    });
});

describe('FX-5 — the sidechain key is time-aligned to the program it ducks', () => {
    const route = { sourceTrackId: 'kick', targetTrackId: 'bass', targetDeviceId: 'dev-sc' };

    beforeEach(() => {
        mockTrackStore.value = null;
        mockSidechainStore.value = null;
        externalLatencyRegistry.clear();
    });

    /** `kick` keys the sidechain compressor sitting on `bass`. */
    function setUpSidechain(options: { kickDevices?: DeviceInput[]; bassUpstreamDevices?: DeviceInput[] }): void {
        mockTrackStore.value = {
            tracks: [
                makeTrack({ id: 'kick', devices: options.kickDevices ?? [] }),
                makeTrack({
                    id: 'bass',
                    devices: [
                        ...(options.bassUpstreamDevices ?? []),
                        { id: 'dev-sc', type: 'builtin-sidechain-compressor' },
                    ],
                }),
            ],
        };
        mockSidechainStore.value = { routes: [{ sourceTrackId: 'kick', targetTrackId: 'bass' }] };
    }

    it('needs no key delay when neither side carries latency', () => {
        setUpSidechain({});

        expect(getSidechainKeyDelay(route)).toBe(0);
    });

    it('delays the key by the program latency sitting upstream of the detector', () => {
        // A 30 ms linear-phase EQ sits before the sidechain compressor on `bass`,
        // so the program reaching the detector is 30 ms late while the raw key
        // tap off `kick` is not: without alignment the ducking fires 30 ms early.
        setUpSidechain({ bassUpstreamDevices: [{ id: 'dev-eq' }] });
        externalLatencyRegistry.set('dev-eq', 30);

        expect(getSidechainKeyDelay(route)).toBeCloseTo(0.03, 10);
    });

    it('cancels the source chain latency that PDC has already compensated for', () => {
        // `kick` runs a 10 ms device, so its post-fader key tap is 10 ms late —
        // but PDC has already pushed `bass` back by that same 10 ms, so the owed
        // alignment is still the full 30 ms of program latency. A naive
        // `upstream - sourceChain` would answer 20 ms and duck 10 ms early.
        setUpSidechain({
            kickDevices: [{ id: 'dev-kick-fx' }],
            bassUpstreamDevices: [{ id: 'dev-eq' }],
        });
        externalLatencyRegistry.set('dev-kick-fx', 10);
        externalLatencyRegistry.set('dev-eq', 30);

        expect(getCompensationDelay('bass')).toBeCloseTo(0.01, 10);
        expect(getSidechainKeyDelay(route)).toBeCloseTo(0.03, 10);
    });

    it('clamps to zero rather than asking for a negative key delay', () => {
        // Engine/store divergence: the live route is wired but the store has not
        // hydrated it, so `kick`'s total misses the detector's own block cost and
        // the arithmetic goes negative. A negative delay is unrepresentable and
        // would widen the error, so alignment clamps at zero.
        setUpSidechain({});
        mockSidechainStore.value = { routes: [] };

        expect(getSidechainKeyDelay(route)).toBe(0);
    });

    it('ignores a bypassed upstream device on the detector track', () => {
        setUpSidechain({ bassUpstreamDevices: [{ id: 'dev-eq', bypassed: true }] });
        externalLatencyRegistry.set('dev-eq', 30);

        expect(getSidechainKeyDelay(route)).toBe(0);
    });

    it('excludes the detector own block cost and every device after it', () => {
        // Only what sits *upstream* of `dev-sc` shifts the program the detector
        // sees; the compressor's own one-block cost and downstream devices do not.
        setUpSidechain({});
        const tracks = mockTrackStore.value!.tracks as { id: string; devices: unknown[] }[];
        tracks.find((track) => track.id === 'bass')!.devices.push(makeDevice({ id: 'dev-post' }));
        externalLatencyRegistry.set('dev-post', 25);

        expect(getSidechainKeyDelay(route)).toBe(0);
        // ...while that trailing device is still on the track total, proving the
        // exclusion is positional and not a blanket zero.
        expect(getTrackLatency('bass').deviceLatencyMs).toBeCloseTo(SC_BLOCK_MS + 25, 10);
    });

    it('follows a mid-session latency push rather than serving a cached alignment', () => {
        setUpSidechain({ bassUpstreamDevices: [{ id: 'dev-eq' }] });
        externalLatencyRegistry.set('dev-eq', 30);
        expect(getSidechainKeyDelay(route)).toBeCloseTo(0.03, 10);

        externalLatencyRegistry.set('dev-eq', 8);

        expect(getSidechainKeyDelay(route)).toBeCloseTo(0.008, 10);
    });
});
