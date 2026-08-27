import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: { value: null as { tracks: unknown[] } | null },
}));
vi.mock('#/modules/Routing/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/stores')>()),
    sidechainStore: { value: null as { routes: unknown[] } | null },
}));
const mocks = vi.hoisted(() => ({
    getLiveEngineSampleRate: vi.fn<() => number | undefined>(() => 96_000),
}));

// The engine rate the plugin was activated with — the same rate the reported
// bridge frames are counted in, which is the whole point of AC-001. It is
// deliberately neither 48000 nor 44100: those are the rates the substituting
// accessors in this path fall back to, so an assertion stated at one of them
// would pass against code that never read the engine at all.
vi.mock('../../../engineAccess/getLiveEngineSampleRate', () => ({
    getLiveEngineSampleRate: mocks.getLiveEngineSampleRate,
}));
vi.mock('../../../engineAccess/getAudioContext', () => ({
    getAudioContext: () => ({ sampleRate: 96_000 }),
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

/** The rate the engine renders at throughout this suite. */
const ENGINE_SAMPLE_RATE = 96_000;

/**
 * What the native host reports for a bridge running on a 512-frame device
 * period: the ten blocks of ring depth the round trip settles at, 128 frames
 * each (`crates/daw-engine/src/audio_bridge.rs`).
 */
const BRIDGE_FRAMES = 10 * 128;
const BRIDGE_MS = (BRIDGE_FRAMES / ENGINE_SAMPLE_RATE) * 1000;
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
        mocks.getLiveEngineSampleRate.mockReturnValue(ENGINE_SAMPLE_RATE);
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
        // every other track would run a whole round trip early against the
        // bridged one.
        expect(getCompensationDelay('drums')).not.toBeCloseTo(PLUGIN_MS / 1000, 6);
    });

    it('converts the reported frames at the engine rate the plugin was activated with', () => {
        reportBridgeRoundTripFrames('dev-native', ENGINE_SAMPLE_RATE);

        // One second of frames at the engine rate is one second of latency. A
        // conversion against any other clock lands somewhere else — against a
        // hardcoded 48 kHz, at twice this.
        expect(getDeviceLatencyMs('dev-native', 'external-plugin')).toBeCloseTo(1000, 10);
    });

    it('reports no bridge latency once the engine that measured it is gone', () => {
        reportBridgeRoundTripFrames('dev-native', BRIDGE_FRAMES);
        mocks.getLiveEngineSampleRate.mockReturnValue(undefined);

        // The frames were counted at a rate that no longer exists, and no
        // audio is crossing the bridge either. Substituting a plausible rate
        // here would report a compensation nothing measured.
        expect(getDeviceLatencyMs('dev-native', 'external-plugin')).toBe(0);
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
