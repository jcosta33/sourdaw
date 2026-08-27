import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: { value: null as { tracks: unknown[] } | null },
}));
vi.mock('#/modules/Routing/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/stores')>()),
    sidechainStore: { value: null as { routes: unknown[] } | null },
}));
// The engine rate the plugin was activated with — the same rate the reported
// bridge frames are counted in, which is the whole point of AC-001.
vi.mock('../../../engineAccess/getAudioContext', () => ({
    getAudioContext: () => ({ sampleRate: 48000 }),
}));

import { trackStore } from '#/modules/Arrangement/stores';

import { clearReportedLatency } from '../clearReportedLatency';
import { clearAllReportedLatency, externalBridgeRoundTripFrames } from '../externalLatencyRegistry';
import { getCompensationDelay } from '../getCompensationDelay';
import { getDeviceLatencyMs } from '../getDeviceLatencyMs';
import { getTrackLatency } from '../getTrackLatency';
import { reportBridgeRoundTripFrames } from '../reportBridgeRoundTripFrames';
import { reportLatency } from '../reportLatency';

type MutableTrackStore = { value: { tracks: unknown[] } | null };
const mockTrackStore = trackStore as unknown as MutableTrackStore;

/**
 * What the native host reports for a bridge running on a 512-frame device
 * period: ten blocks of ring depth plus the relay's own block, at 128 frames
 * each (`crates/daw-engine/src/audio_bridge.rs`).
 */
const BRIDGE_FRAMES = 11 * 128;
const BRIDGE_MS = (BRIDGE_FRAMES / 48_000) * 1000;
/** The plugin's own reported lookahead. */
const PLUGIN_MS = 5;

function makeTrack(overrides: { id: string; devices?: { id: string; type?: string }[] }) {
    return {
        id: overrides.id,
        kind: 'audio',
        outputId: 'hw_out',
        devices: (overrides.devices ?? []).map((device) => ({
            id: device.id,
            name: device.id,
            type: device.type ?? 'external-plugin',
            bypassed: false,
            parameterValues: {},
        })),
        sends: [],
    };
}

/** A bridged plugin on `guitar`, plus an unprocessed `drums` track to compensate. */
function setUpBridgedPluginProject(): void {
    mockTrackStore.value = {
        tracks: [makeTrack({ id: 'guitar', devices: [{ id: 'dev-native' }] }), makeTrack({ id: 'drums' })],
    };
}

describe('the audio bridge round trip is compensated alongside the plugin (AC-002)', () => {
    beforeEach(() => {
        mockTrackStore.value = null;
        clearAllReportedLatency();
    });

    it('adds the reported bridge round trip to the plugin latency for that device', () => {
        reportLatency('dev-native', PLUGIN_MS);
        reportBridgeRoundTripFrames('dev-native', BRIDGE_FRAMES);

        // The plugin's own figure alone is what shipped, and it is short by the
        // whole round trip: the relay hands the block to the native host, the
        // host queues it for the audio callback, processes it, and queues it
        // back. None of that is in `latency_ms`.
        expect(getDeviceLatencyMs('dev-native', 'external-plugin')).toBeCloseTo(PLUGIN_MS + BRIDGE_MS, 10);
        expect(getDeviceLatencyMs('dev-native', 'external-plugin')).toBeGreaterThan(PLUGIN_MS);
    });

    it('compensates every other track for the bridge, not only for the plugin', () => {
        setUpBridgedPluginProject();
        reportLatency('dev-native', PLUGIN_MS);
        reportBridgeRoundTripFrames('dev-native', BRIDGE_FRAMES);

        expect(getTrackLatency('guitar').deviceLatencyMs).toBeCloseTo(PLUGIN_MS + BRIDGE_MS, 10);
        expect(getCompensationDelay('drums')).toBeCloseTo((PLUGIN_MS + BRIDGE_MS) / 1000, 10);
        // Without the bridge term this would be the plugin's 5 ms alone, and
        // every other track would run ~29 ms early against the bridged one.
        expect(getCompensationDelay('drums')).not.toBeCloseTo(PLUGIN_MS / 1000, 6);
    });

    it('converts the reported frames at the engine rate the plugin was activated with', () => {
        reportBridgeRoundTripFrames('dev-native', 48_000);

        // One second of frames at the engine rate is one second of latency. A
        // conversion against any other clock lands somewhere else.
        expect(getDeviceLatencyMs('dev-native', 'external-plugin')).toBeCloseTo(1000, 10);
    });

    it('compensates the bridge for a plugin that has reported no latency of its own', () => {
        reportBridgeRoundTripFrames('dev-native', BRIDGE_FRAMES);

        // A plugin reporting zero is still fed through the bridge, so the track
        // hosting it is still late by the round trip.
        expect(getDeviceLatencyMs('dev-native', 'external-plugin')).toBeCloseTo(BRIDGE_MS, 10);
    });

    it('adds nothing for an external plugin the host reported no bridge for', () => {
        reportLatency('dev-native', PLUGIN_MS);

        // A load with no engine behind it crosses no bridge, and compensating
        // for one would push every other track late by a latency that is not
        // there.
        expect(getDeviceLatencyMs('dev-native', 'external-plugin')).toBe(PLUGIN_MS);
    });

    it('leaves a built-in device that reports its own latency untouched', () => {
        reportLatency('dev-wasm', 12);
        // A stale entry under the same id must not reach a device that does not
        // use the bridge at all.
        reportBridgeRoundTripFrames('dev-wasm', BRIDGE_FRAMES);

        expect(getDeviceLatencyMs('dev-wasm', 'builtin-eq')).toBe(12);
    });

    it('drops the bridge contribution when the device is torn down', () => {
        setUpBridgedPluginProject();
        reportLatency('dev-native', PLUGIN_MS);
        reportBridgeRoundTripFrames('dev-native', BRIDGE_FRAMES);

        clearReportedLatency('dev-native');

        // Both halves go together: a surviving bridge entry would compensate a
        // plugin that is no longer in the chain.
        expect(externalBridgeRoundTripFrames.has('dev-native')).toBe(false);
        expect(getTrackLatency('guitar').totalLatencyMs).toBe(0);
        expect(getCompensationDelay('drums')).toBe(0);
    });

    it('drops every bridge contribution when the graph is reset', () => {
        reportBridgeRoundTripFrames('dev-native', BRIDGE_FRAMES);

        clearAllReportedLatency();

        expect(getDeviceLatencyMs('dev-native', 'external-plugin')).toBe(0);
    });
});
