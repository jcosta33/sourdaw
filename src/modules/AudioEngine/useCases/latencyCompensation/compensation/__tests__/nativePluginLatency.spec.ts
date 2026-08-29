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
 * example RT-4 cites. Expressed in ms because the native host converts at the
 * rate the plugin was activated with (PH-4), not the webview context rate.
 */
const LIN_PHASE_MS = (1500 / 48_000) * 1000;

type DeviceInput = { id: string; type?: string; bypassed?: boolean };

function makeTrack(overrides: { id: string; devices?: DeviceInput[]; outputId?: string }) {
    return {
        id: overrides.id,
        kind: 'audio',
        outputId: overrides.outputId ?? 'hw_out',
        devices: (overrides.devices ?? []).map((device) => ({
            id: device.id,
            name: device.id,
            type: device.type ?? 'external-plugin',
            bypassed: device.bypassed ?? false,
            parameterValues: {},
        })),
        sends: [],
    };
}

/** A native plugin on `guitar`, plus an unprocessed `drums` track to compensate. */
function setUpNativePluginProject(): void {
    mockTrackStore.value = {
        tracks: [makeTrack({ id: 'guitar', devices: [{ id: 'dev-native' }] }), makeTrack({ id: 'drums' })],
    };
}

describe('native plugin latency reaches plugin-delay compensation (RT-4)', () => {
    beforeEach(() => {
        mockTrackStore.value = null;
        externalLatencyRegistry.clear();
    });

    it('folds a reported native-plugin latency into its own track total', () => {
        setUpNativePluginProject();
        reportLatency('dev-native', LIN_PHASE_MS);

        expect(getTrackLatency('guitar')).toEqual({
            trackId: 'guitar',
            deviceLatencyMs: LIN_PHASE_MS,
            totalLatencyMs: LIN_PHASE_MS,
        });
    });

    it('delays every other track by the native plugin latency, and the plugin track by nothing', () => {
        setUpNativePluginProject();
        reportLatency('dev-native', LIN_PHASE_MS);

        // drums carries no latency, so it must be pushed back by the full amount
        // the guitar chain costs; the guitar itself is already the late one.
        expect(getCompensationDelay('drums')).toBeCloseTo(LIN_PHASE_MS / 1000, 10);
        expect(getCompensationDelay('guitar')).toBe(0);
    });

    it('reports zero compensation while the native plugin has not reported yet', () => {
        setUpNativePluginProject();

        // No reportLatency call: an external-plugin device carries no static
        // entry in deviceLatencyMap, so nothing is compensated.
        expect(getTrackLatency('guitar').totalLatencyMs).toBe(0);
        expect(getCompensationDelay('drums')).toBe(0);
    });

    it('recomputes compensation when the host pushes a mid-session latency change', () => {
        setUpNativePluginProject();
        reportLatency('dev-native', LIN_PHASE_MS);
        expect(getCompensationDelay('drums')).toBeCloseTo(LIN_PHASE_MS / 1000, 10);

        // plugin-latency-changed (PH-4) lands a smaller lookahead: the delay must
        // follow it down rather than serving a cached value.
        reportLatency('dev-native', 4);

        expect(getTrackLatency('guitar').totalLatencyMs).toBe(4);
        expect(getCompensationDelay('drums')).toBeCloseTo(0.004, 10);
    });

    it('drops the compensation when the plugin instance is torn down', () => {
        setUpNativePluginProject();
        reportLatency('dev-native', LIN_PHASE_MS);

        clearReportedLatency('dev-native');

        expect(getTrackLatency('guitar').totalLatencyMs).toBe(0);
        expect(getCompensationDelay('drums')).toBe(0);
    });

    it('ignores a bypassed native plugin', () => {
        mockTrackStore.value = {
            tracks: [
                makeTrack({ id: 'guitar', devices: [{ id: 'dev-native', bypassed: true }] }),
                makeTrack({ id: 'drums' }),
            ],
        };
        reportLatency('dev-native', LIN_PHASE_MS);

        expect(getTrackLatency('guitar').totalLatencyMs).toBe(0);
        expect(getCompensationDelay('drums')).toBe(0);
    });

    it('compensates upstream tracks for a native plugin hosted on a downstream bus', () => {
        mockTrackStore.value = {
            tracks: [
                makeTrack({ id: 'guitar', outputId: 'bus-fx' }),
                makeTrack({ id: 'drums' }),
                makeTrack({ id: 'bus-fx', devices: [{ id: 'dev-native' }] }),
            ],
        };
        reportLatency('dev-native', LIN_PHASE_MS);

        // guitar itself hosts nothing, but everything it feeds costs the plugin's
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

    it('sums two native plugins on the same chain', () => {
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

    it('omitting external-plugin on the queried track drops its own device latency from the total', () => {
        setUpNativePluginProject();
        reportLatency('dev-native', LIN_PHASE_MS);

        expect(getTrackLatency('guitar', new Set(), ['external-plugin'])).toEqual({
            trackId: 'guitar',
            deviceLatencyMs: 0,
            totalLatencyMs: 0,
        });
        // Live max still includes the plugin, so omitted compensation matches drums'.
        expect(getCompensationDelay('guitar', ['external-plugin'])).toBeCloseTo(LIN_PHASE_MS / 1000, 10);
        expect(getCompensationDelay('guitar')).toBe(0);
    });

    it('does not pass omit into recursive downstream latency when the plugin is on a bus', () => {
        mockTrackStore.value = {
            tracks: [
                makeTrack({ id: 'guitar', outputId: 'bus-fx' }),
                makeTrack({ id: 'drums' }),
                makeTrack({ id: 'bus-fx', devices: [{ id: 'dev-native' }] }),
            ],
        };
        reportLatency('dev-native', LIN_PHASE_MS);

        expect(getTrackLatency('guitar', new Set(), ['external-plugin']).totalLatencyMs).toBe(LIN_PHASE_MS);
        expect(getCompensationDelay('guitar', ['external-plugin'])).toBe(0);
    });
});
