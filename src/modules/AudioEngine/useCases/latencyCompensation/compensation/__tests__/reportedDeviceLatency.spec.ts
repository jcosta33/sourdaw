/**
 * A device that reports its own lookahead reaches plugin-delay compensation
 * (RT-4).
 *
 * The device under test is a WASM built-in, because that is what Web Audio still
 * hosts and still delays for. An `external-plugin` is sounded by the native
 * engine and costs this graph nothing at all — that law, and the reasons for it,
 * live in `externalPluginCompensation.spec.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: { value: null as { tracks: unknown[] } | null },
}));
vi.mock('#/modules/Routing/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/stores')>()),
    sidechainStore: { value: null as { routes: unknown[] } | null },
}));
// Pin the sample rate so no built-in device latency leaks into these totals.
vi.mock('../../../engineAccess/getAudioContext', () => ({
    getAudioContext: () => ({ sampleRate: 48000 }),
}));

import { trackStore } from '#/modules/Arrangement/stores';

import { clearReportedLatency } from '../clearReportedLatency';
import { externalLatencyRegistry } from '../externalLatencyRegistry';
import { getCompensationDelay } from '../getCompensationDelay';
import { getTrackLatency } from '../getTrackLatency';
import { reportLatency } from '../reportLatency';

type MutableTrackStore = { value: { tracks: unknown[] } | null };
const mockTrackStore = trackStore as unknown as MutableTrackStore;

/**
 * A linear-phase EQ's worth of lookahead: 1500 samples @48k, the golden-standard
 * example RT-4 cites. Expressed in ms because a device reports its figure in ms,
 * converted at the rate it is running at rather than the webview context rate.
 */
const LIN_PHASE_MS = (1500 / 48_000) * 1000;

/** The device type these tracks host: a WASM built-in Web Audio renders itself. */
const REPORTING_TYPE = 'knead';

type DeviceInput = { id: string; type?: string; bypassed?: boolean };

function makeTrack(overrides: { id: string; devices?: DeviceInput[]; outputId?: string }) {
    return {
        id: overrides.id,
        kind: 'audio',
        outputId: overrides.outputId ?? 'hw_out',
        devices: (overrides.devices ?? []).map((device) => ({
            id: device.id,
            name: device.id,
            type: device.type ?? REPORTING_TYPE,
            bypassed: device.bypassed ?? false,
            parameterValues: {},
        })),
        sends: [],
    };
}

/** A reporting device on `guitar`, plus an unprocessed `drums` track to compensate. */
function setUpReportingDeviceProject(): void {
    mockTrackStore.value = {
        tracks: [makeTrack({ id: 'guitar', devices: [{ id: 'dev-wasm' }] }), makeTrack({ id: 'drums' })],
    };
}

describe('a reported device latency reaches plugin-delay compensation (RT-4)', () => {
    beforeEach(() => {
        mockTrackStore.value = null;
        externalLatencyRegistry.clear();
    });

    it('folds a reported device latency into its own track total', () => {
        setUpReportingDeviceProject();
        reportLatency('dev-wasm', LIN_PHASE_MS);

        expect(getTrackLatency('guitar')).toEqual({
            trackId: 'guitar',
            deviceLatencyMs: LIN_PHASE_MS,
            totalLatencyMs: LIN_PHASE_MS,
        });
    });

    it('delays every other track by that latency, and the reporting track by nothing', () => {
        setUpReportingDeviceProject();
        reportLatency('dev-wasm', LIN_PHASE_MS);

        // drums carries no latency, so it must be pushed back by the full amount
        // the guitar chain costs; the guitar itself is already the late one.
        expect(getCompensationDelay('drums')).toBeCloseTo(LIN_PHASE_MS / 1000, 10);
        expect(getCompensationDelay('guitar')).toBe(0);
    });

    it('reports zero compensation while the device has not reported yet', () => {
        setUpReportingDeviceProject();

        // No reportLatency call, and no static entry in deviceLatencyMap for
        // this type, so nothing is compensated.
        expect(getTrackLatency('guitar').totalLatencyMs).toBe(0);
        expect(getCompensationDelay('drums')).toBe(0);
    });

    it('recomputes compensation when the device pushes a mid-session latency change', () => {
        setUpReportingDeviceProject();
        reportLatency('dev-wasm', LIN_PHASE_MS);
        expect(getCompensationDelay('drums')).toBeCloseTo(LIN_PHASE_MS / 1000, 10);

        // A smaller lookahead lands: the delay must follow it down rather than
        // serving a cached value.
        reportLatency('dev-wasm', 4);

        expect(getTrackLatency('guitar').totalLatencyMs).toBe(4);
        expect(getCompensationDelay('drums')).toBeCloseTo(0.004, 10);
    });

    it('drops the compensation when the device is torn down', () => {
        setUpReportingDeviceProject();
        reportLatency('dev-wasm', LIN_PHASE_MS);

        clearReportedLatency('dev-wasm');

        expect(getTrackLatency('guitar').totalLatencyMs).toBe(0);
        expect(getCompensationDelay('drums')).toBe(0);
    });

    it('ignores a bypassed device', () => {
        mockTrackStore.value = {
            tracks: [
                makeTrack({ id: 'guitar', devices: [{ id: 'dev-wasm', bypassed: true }] }),
                makeTrack({ id: 'drums' }),
            ],
        };
        reportLatency('dev-wasm', LIN_PHASE_MS);

        expect(getTrackLatency('guitar').totalLatencyMs).toBe(0);
        expect(getCompensationDelay('drums')).toBe(0);
    });

    it('compensates upstream tracks for a device hosted on a downstream bus', () => {
        mockTrackStore.value = {
            tracks: [
                makeTrack({ id: 'guitar', outputId: 'bus-fx' }),
                makeTrack({ id: 'drums' }),
                makeTrack({ id: 'bus-fx', devices: [{ id: 'dev-wasm' }] }),
            ],
        };
        reportLatency('dev-wasm', LIN_PHASE_MS);

        // guitar itself hosts nothing, but everything it feeds costs the device's
        // lookahead, so its total must carry the downstream cost...
        expect(getTrackLatency('guitar')).toEqual({
            trackId: 'guitar',
            deviceLatencyMs: 0,
            totalLatencyMs: LIN_PHASE_MS,
        });
        // ...and drums, which bypasses the bus, is the one that needs delaying.
        expect(getCompensationDelay('drums')).toBeCloseTo(LIN_PHASE_MS / 1000, 10);
        expect(getCompensationDelay('guitar')).toBe(0);
    });

    it('sums two reporting devices on the same chain', () => {
        mockTrackStore.value = {
            tracks: [
                makeTrack({ id: 'guitar', devices: [{ id: 'dev-eq' }, { id: 'dev-limiter' }] }),
                makeTrack({ id: 'drums' }),
            ],
        };
        reportLatency('dev-eq', LIN_PHASE_MS);
        reportLatency('dev-limiter', 5);

        expect(getTrackLatency('guitar').deviceLatencyMs).toBeCloseTo(LIN_PHASE_MS + 5, 10);
        expect(getCompensationDelay('drums')).toBeCloseTo((LIN_PHASE_MS + 5) / 1000, 10);
    });

    it('omitting the type on the queried track drops its own device latency from the total', () => {
        setUpReportingDeviceProject();
        reportLatency('dev-wasm', LIN_PHASE_MS);

        expect(getTrackLatency('guitar', new Set(), [REPORTING_TYPE])).toEqual({
            trackId: 'guitar',
            deviceLatencyMs: 0,
            totalLatencyMs: 0,
        });
        // Live max still includes the device, so omitted compensation matches drums'.
        expect(getCompensationDelay('guitar', [REPORTING_TYPE])).toBeCloseTo(LIN_PHASE_MS / 1000, 10);
        expect(getCompensationDelay('guitar')).toBe(0);
    });

    it('does not pass omit into recursive downstream latency when the device is on a bus', () => {
        mockTrackStore.value = {
            tracks: [
                makeTrack({ id: 'guitar', outputId: 'bus-fx' }),
                makeTrack({ id: 'drums' }),
                makeTrack({ id: 'bus-fx', devices: [{ id: 'dev-wasm' }] }),
            ],
        };
        reportLatency('dev-wasm', LIN_PHASE_MS);

        expect(getTrackLatency('guitar', new Set(), [REPORTING_TYPE]).totalLatencyMs).toBe(LIN_PHASE_MS);
        expect(getCompensationDelay('guitar', [REPORTING_TYPE])).toBe(0);
    });
});
