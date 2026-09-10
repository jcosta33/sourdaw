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

/**
 * Bacteria's spectral window at 48k, the figure its own `BacteriaNode` reports
 * into the registry while the strip is web-carried, and the figure the native
 * engine declares for it while the strip is engine-carried
 * (`PluginCore::declared_latency_frames`, `crates/daw-engine/src/scheduler.rs`).
 * The exclusion is only observable on a device that really delays this graph,
 * so the reported figure is what the assertions below move.
 */
const BACTERIA_MS = (2048 / 48_000) * 1000;
const ENGINE_COMPENSATED_TYPE = 'bacteria';

/** A bacteria strip beside a bare one, with the bacteria's figure reported. */
function setUpEngineCompensatedProject(): void {
    mockTrackStore.value = {
        tracks: [
            makeTrack({ id: 'guitar', devices: [{ id: 'dev-bacteria', type: ENGINE_COMPENSATED_TYPE }] }),
            makeTrack({ id: 'drums' }),
        ],
    };
    reportLatency('dev-bacteria', BACTERIA_MS);
}

describe('getCompensationDelay with engine-hosted strips', () => {
    beforeEach(() => {
        mockTrackStore.value = null;
        clearAllReportedLatency();
    });

    it('counts an engine-compensated device on every strip when no strip is engine-hosted', () => {
        setUpEngineCompensatedProject();

        expect(getCompensationDelay('drums')).toBeCloseTo(BACTERIA_MS / 1000, 10);
    });

    it('costs nothing on a strip the engine hosts, in that strip and in the session max', () => {
        setUpEngineCompensatedProject();

        // The engine holds every route meeting guitar back by the figure
        // itself, so this side must read guitar as undelayed — and with the
        // session's only latency gone, drums waits for nothing either.
        expect(getCompensationDelay('guitar', undefined, new Set(['guitar']))).toBe(0);
        expect(getCompensationDelay('drums', undefined, new Set(['guitar']))).toBe(0);
    });

    it('keeps costing its reported figure on a strip the engine does not host', () => {
        setUpEngineCompensatedProject();

        // A native session carrying only drums leaves guitar on Web Audio,
        // where its gated worklet's own figure is what aligns it.
        expect(getCompensationDelay('drums', undefined, new Set(['drums']))).toBeCloseTo(BACTERIA_MS / 1000, 10);
    });

    it('excludes an engine-compensated device on a hosted strip downstream of the queried one', () => {
        mockTrackStore.value = {
            tracks: [
                makeTrack({ id: 'guitar', outputId: 'bus-fx' }),
                makeTrack({ id: 'drums' }),
                makeTrack({ id: 'bus-fx', devices: [{ id: 'dev-bacteria', type: ENGINE_COMPENSATED_TYPE }] }),
            ],
        };
        reportLatency('dev-bacteria', BACTERIA_MS);

        // Unlike an omitted type, engine hosting is a fact about the graph
        // rather than about one queried strip: the bus really is undelayed on
        // this side, so guitar's own total loses the bus's figure too.
        expect(getCompensationDelay('guitar', undefined, new Set(['bus-fx']))).toBe(0);
        expect(getCompensationDelay('drums', undefined, new Set(['bus-fx']))).toBe(0);
        expect(getCompensationDelay('drums')).toBeCloseTo(BACTERIA_MS / 1000, 10);
    });

    it('leaves a device the engine does not compensate counted on a hosted strip', () => {
        setUpProcessedTrackProject();

        // Hosting excludes the engine-compensated bodies alone. A Knead on a
        // carried strip is still delayed by its own worklet report, because
        // the engine declares nothing for it.
        expect(getCompensationDelay('drums', undefined, new Set(['guitar']))).toBeCloseTo(DEVICE_MS / 1000, 10);
    });

    it('reads a hosted plugin as undelayed whether or not its strip is engine-hosted', () => {
        mockTrackStore.value = {
            tracks: [
                makeTrack({ id: 'guitar', devices: [{ id: 'dev-plugin', type: 'external-plugin' }] }),
                makeTrack({ id: 'drums' }),
            ],
        };
        reportLatency('dev-plugin', BACTERIA_MS);

        // The exclusion this file's other cases add is the one
        // `getDeviceLatencyMs` already makes for a hosted plugin, so a hosted
        // plugin's figure stays out of the sum on either footing.
        expect(getCompensationDelay('drums')).toBe(0);
        expect(getCompensationDelay('drums', undefined, new Set(['guitar']))).toBe(0);
    });

    it('leaves the omit semantics untouched on a hosted strip', () => {
        setUpProcessedTrackProject();

        // Omit still shrinks only the queried strip's own loop, and the max it
        // is measured against still counts the withheld type.
        expect(getCompensationDelay('guitar', [WITHHELD_TYPE], new Set(['guitar']))).toBeCloseTo(DEVICE_MS / 1000, 10);
    });
});
