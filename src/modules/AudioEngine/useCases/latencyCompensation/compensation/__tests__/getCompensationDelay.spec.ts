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
    getLiveEngineSampleRate: vi.fn<() => number | undefined>(() => 48_000),
}));

vi.mock('../../../engineAccess/getLiveEngineSampleRate', () => ({
    getLiveEngineSampleRate: mocks.getLiveEngineSampleRate,
}));
vi.mock('../../../engineAccess/getAudioContext', () => ({
    getAudioContext: () => ({ sampleRate: 48_000 }),
}));

import { trackStore } from '#/modules/Arrangement/stores';

import { clearAllReportedLatency } from '../externalLatencyRegistry';
import { getCompensationDelay } from '../getCompensationDelay';
import { reportBridgeRoundTripFrames } from '../reportBridgeRoundTripFrames';
import { reportLatency } from '../reportLatency';

type MutableTrackStore = { value: { tracks: unknown[] } | null };
const mockTrackStore = trackStore as unknown as MutableTrackStore;

const ENGINE_SAMPLE_RATE = 48_000;
/** Plugin lookahead reported by the host. */
const PLUGIN_MS = (1500 / 48_000) * 1000;
/** Bridge round-trip frames at the engine rate (ten 128-frame blocks). */
const BRIDGE_FRAMES = 10 * 128;
const BRIDGE_MS = (BRIDGE_FRAMES / ENGINE_SAMPLE_RATE) * 1000;
const LIVE_PLUGIN_PLUS_BRIDGE_MS = PLUGIN_MS + BRIDGE_MS;

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

function setUpNativePluginProject(): void {
    mockTrackStore.value = {
        tracks: [makeTrack({ id: 'guitar', devices: [{ id: 'dev-native' }] }), makeTrack({ id: 'drums' })],
    };
    reportLatency('dev-native', PLUGIN_MS);
    reportBridgeRoundTripFrames('dev-native', BRIDGE_FRAMES);
}

describe('getCompensationDelay with withheld device types (freeze print fidelity)', () => {
    beforeEach(() => {
        mockTrackStore.value = null;
        clearAllReportedLatency();
        mocks.getLiveEngineSampleRate.mockReturnValue(ENGINE_SAMPLE_RATE);
    });

    it('keeps live compensation at 0 when the queried track is the session max', () => {
        setUpNativePluginProject();

        expect(getCompensationDelay('guitar')).toBe(0);
        expect(getCompensationDelay('drums')).toBeCloseTo(LIVE_PLUGIN_PLUS_BRIDGE_MS / 1000, 10);
    });

    it('omitting external-plugin on the plugin track equals the delay other tracks already get live', () => {
        setUpNativePluginProject();

        // Offline freeze withholds the plugin: the printed buffer is dry, so the
        // pin must match the delay drums already receive for this plugin+bridge.
        // Max stays live (still includes the plugin); only this track's own loop
        // omits the type.
        expect(getCompensationDelay('guitar', ['external-plugin'])).toBeCloseTo(LIVE_PLUGIN_PLUS_BRIDGE_MS / 1000, 10);
        expect(getCompensationDelay('guitar', ['external-plugin'])).toBeCloseTo(getCompensationDelay('drums'), 10);
    });

    it('does not change the figure when the omitted type is not on the track', () => {
        setUpNativePluginProject();

        expect(getCompensationDelay('drums', ['external-plugin'])).toBeCloseTo(getCompensationDelay('drums'), 10);
        expect(getCompensationDelay('guitar', ['builtin-eq'])).toBe(0);
    });

    it('still counts a plugin on a downstream bus when omitting external-plugin on the source', () => {
        mockTrackStore.value = {
            tracks: [
                makeTrack({ id: 'guitar', outputId: 'bus-fx' }),
                makeTrack({ id: 'drums' }),
                makeTrack({ id: 'bus-fx', devices: [{ id: 'dev-native' }] }),
            ],
        };
        reportLatency('dev-native', PLUGIN_MS);
        reportBridgeRoundTripFrames('dev-native', BRIDGE_FRAMES);

        // Omit applies only to guitar's own device loop. The bus plugin is
        // downstream of what freeze printed on guitar, so recursion must still
        // carry it — otherwise freeze would over-delay against the live mix.
        expect(getCompensationDelay('guitar', ['external-plugin'])).toBe(0);
        expect(getCompensationDelay('drums')).toBeCloseTo(LIVE_PLUGIN_PLUS_BRIDGE_MS / 1000, 10);
    });
});
