/**
 * What an external plugin costs the Web Audio graph, now that it costs it
 * nothing (#3564).
 *
 * The device that used to stand in the plugin's place relayed audio out to the
 * native host and back, and that round trip was compensated here. The native
 * engine now hosts and sounds the plugin outright; what is left in the Web Audio
 * chain is a unity gain pass-through, and a pass-through delays no sample.
 *
 * Compensating anyway is not a harmless leftover: `getCompensationDelay` pushes
 * every *other* track back by the session maximum, so a phantom figure here
 * delays the whole mix against a delay that is not in it.
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
vi.mock('../../../engineAccess/getAudioContext', () => ({
    getAudioContext: () => ({ sampleRate: 48_000 }),
}));

import { trackStore } from '#/modules/Arrangement/stores';

import { clearAllReportedLatency } from '../externalLatencyRegistry';
import { getCompensationDelay } from '../getCompensationDelay';
import { getDeviceLatencyMs } from '../getDeviceLatencyMs';
import { getTrackLatency } from '../getTrackLatency';
import { reportLatency } from '../reportLatency';

type MutableTrackStore = { value: { tracks: unknown[] } | null };
const mockTrackStore = trackStore as unknown as MutableTrackStore;

/** A plugin lookahead large enough that a leak would be unmistakable: 1500 samples @48k. */
const PLUGIN_MS = (1500 / 48_000) * 1000;

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

/** A hosted plugin on `guitar`, plus a bare `drums` track that would be delayed for it. */
function setUpHostedPluginProject(): void {
    mockTrackStore.value = {
        tracks: [makeTrack({ id: 'guitar', devices: [{ id: 'dev-native' }] }), makeTrack({ id: 'drums' })],
    };
}

describe('an external-plugin device costs the Web Audio graph nothing', () => {
    beforeEach(() => {
        mockTrackStore.value = null;
        clearAllReportedLatency();
    });

    it('adds no plugin lookahead either, because the engine that applies it also sounds it', () => {
        // The lookahead is real, and it is the native engine's to compensate.
        // Charging it to the Web Audio chain would delay every Web Audio track
        // for a delay none of them is behind.
        reportLatency('dev-native', PLUGIN_MS);

        expect(getDeviceLatencyMs('dev-native', 'external-plugin')).toBe(0);
    });

    it('leaves every other track undelayed for a hosted plugin', () => {
        setUpHostedPluginProject();
        reportLatency('dev-native', PLUGIN_MS);

        expect(getTrackLatency('guitar').deviceLatencyMs).toBe(0);
        expect(getCompensationDelay('drums')).toBe(0);
    });

    it('leaves a built-in device that reports its own latency untouched', () => {
        reportLatency('dev-wasm', 12);

        // The zero rule must not spread past the one device type it is about.
        expect(getDeviceLatencyMs('dev-wasm', 'builtin-eq')).toBe(12);
    });
});
