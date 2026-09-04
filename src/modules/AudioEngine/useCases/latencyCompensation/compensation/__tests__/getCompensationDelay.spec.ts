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
import { reportLatency } from '../reportLatency';

type MutableTrackStore = { value: { tracks: unknown[] } | null };
const mockTrackStore = trackStore as unknown as MutableTrackStore;

/**
 * A WASM built-in's lookahead, reported by the device itself: 1500 samples
 * @48k. The withheld-type mechanism is exercised on a device Web Audio actually
 * hosts and actually delays for — an `external-plugin` costs this graph nothing
 * (`externalPluginCompensation.spec.ts`), so omitting one could never move a
 * figure and would prove nothing about the omission.
 */
const DEVICE_MS = (1500 / 48_000) * 1000;
const WITHHELD_TYPE = 'knead';

type DeviceInput = { id: string; type?: string; bypassed?: boolean };

function makeTrack(overrides: { id: string; devices?: DeviceInput[]; outputId?: string }) {
    return {
        id: overrides.id,
        kind: 'audio',
        outputId: overrides.outputId ?? 'hw_out',
        devices: (overrides.devices ?? []).map((device) => ({
            id: device.id,
            name: device.id,
            type: device.type ?? WITHHELD_TYPE,
            bypassed: device.bypassed ?? false,
            parameterValues: {},
        })),
        sends: [],
    };
}

function setUpProcessedTrackProject(): void {
    mockTrackStore.value = {
        tracks: [makeTrack({ id: 'guitar', devices: [{ id: 'dev-wasm' }] }), makeTrack({ id: 'drums' })],
    };
    reportLatency('dev-wasm', DEVICE_MS);
}

describe('getCompensationDelay with withheld device types (freeze print fidelity)', () => {
    beforeEach(() => {
        mockTrackStore.value = null;
        clearAllReportedLatency();
    });

    it('keeps live compensation at 0 when the queried track is the session max', () => {
        setUpProcessedTrackProject();

        expect(getCompensationDelay('guitar')).toBe(0);
        expect(getCompensationDelay('drums')).toBeCloseTo(DEVICE_MS / 1000, 10);
    });

    it('omitting the withheld type on its own track equals the delay other tracks already get live', () => {
        setUpProcessedTrackProject();

        // Offline freeze withholds the device: the printed buffer is dry, so the
        // pin must match the delay drums already receives for it. Max stays live
        // (still includes the device); only this track's own loop omits the type.
        expect(getCompensationDelay('guitar', [WITHHELD_TYPE])).toBeCloseTo(DEVICE_MS / 1000, 10);
        expect(getCompensationDelay('guitar', [WITHHELD_TYPE])).toBeCloseTo(getCompensationDelay('drums'), 10);
    });

    it('does not change the figure when the omitted type is not on the track', () => {
        setUpProcessedTrackProject();

        expect(getCompensationDelay('drums', [WITHHELD_TYPE])).toBeCloseTo(getCompensationDelay('drums'), 10);
        expect(getCompensationDelay('guitar', ['builtin-eq'])).toBe(0);
    });

    it('still counts a withheld type on a downstream bus when omitting it on the source', () => {
        mockTrackStore.value = {
            tracks: [
                makeTrack({ id: 'guitar', outputId: 'bus-fx' }),
                makeTrack({ id: 'drums' }),
                makeTrack({ id: 'bus-fx', devices: [{ id: 'dev-wasm' }] }),
            ],
        };
        reportLatency('dev-wasm', DEVICE_MS);

        // Omit applies only to guitar's own device loop. The bus device is
        // downstream of what freeze printed on guitar, so recursion must still
        // carry it — otherwise freeze would over-delay against the live mix.
        expect(getCompensationDelay('guitar', [WITHHELD_TYPE])).toBe(0);
        expect(getCompensationDelay('drums')).toBeCloseTo(DEVICE_MS / 1000, 10);
    });
});
