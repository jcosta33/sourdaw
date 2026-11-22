import { change, from, type Doc } from '@automerge/automerge';
import { afterEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
    resetAutomergeStorageProjections,
} from '#/infra/store/storage/createAutomergeStorage';

import { clampDeviceParameterValue } from '../../models/DeviceParameterLaw';
import {
    encodeStoredDeviceParameterValues,
    migrateStoredDeviceParameterValues,
} from '../../models/StoredDeviceParameterMigration';
import { createTrack, type Track } from '../../models/Track';
import { composeAddedDeviceParameterValues } from '../../useCases/device/composeAddedDeviceParameterValues';
import { getPluginById } from '../../useCases/getPluginById';
import { sanitizeTrackSnapshot, trackStore } from '../trackStore';

/**
 * The Brick-Wall Limiter's `release` was redeclared from seconds (0.01..1,
 * default 0.1) to milliseconds (1..1000, default 100). Every value a project
 * could legitimately hold under the old declaration is below the new minimum,
 * and `clampDeviceParameterValue` pins a below-minimum write to the minimum —
 * so without a migration a stored 100 ms release loads as 1 ms, the fastest
 * setting in the new range, and pumps on any low-frequency content.
 *
 * `sanitizeTrackSnapshot` is the CRDT hydrate / project-load projection, so a
 * fixture pushed through it is a stored project being opened.
 */

function storedProjectWithLimiter(release: number): unknown {
    return {
        tracks: [
            {
                id: 'master',
                name: 'Master',
                kind: 'audio',
                devices: [
                    {
                        id: 'dev-limiter',
                        name: 'Brick-Wall Limiter',
                        type: 'faust-brick-wall-limiter',
                        bypassed: false,
                        parameterValues: { ceiling: -0.3, release },
                    },
                ],
            },
        ],
        selectedTrackId: 'master',
    };
}

function loadedRelease(snapshot: unknown): number | undefined {
    const restored = sanitizeTrackSnapshot(snapshot);
    const device = restored.tracks[0]?.devices[0];
    if (!device) {
        return undefined;
    }
    const stored = device.parameterValues.release;
    if (stored === undefined) {
        return undefined;
    }
    // What the device actually receives, not just what the store holds.
    return clampDeviceParameterValue({ deviceType: device.type, paramId: 'release', value: stored });
}

describe('stored Brick-Wall Limiter release survives the seconds → milliseconds redeclaration', () => {
    it('delivers a project that stored 0.1 s as 100 ms', () => {
        expect(loadedRelease(storedProjectWithLimiter(0.1))).toBe(100);
    });

    it('maps the old declared range onto the new one', () => {
        // Old range was 0.01..1 s; the new one is 1..1000 ms.
        expect(loadedRelease(storedProjectWithLimiter(0.01))).toBe(10);
        expect(loadedRelease(storedProjectWithLimiter(0.5))).toBe(500);
        expect(loadedRelease(storedProjectWithLimiter(0.999))).toBe(999);
    });

    it('leaves a value already stored in milliseconds alone', () => {
        expect(loadedRelease(storedProjectWithLimiter(250))).toBe(250);
        expect(loadedRelease(storedProjectWithLimiter(1000))).toBe(1000);
        // The one ambiguous value: 1 is both the old maximum in seconds and the
        // new minimum in milliseconds, and nothing in the record tells them
        // apart. The boundary sits on the old side deliberately, so a value
        // written under the current declaration is never rewritten.
        expect(loadedRelease(storedProjectWithLimiter(1))).toBe(1);
    });

    it('is idempotent, because the projection re-runs on every document change', () => {
        // `sanitizeTrackSnapshot` runs on each CRDT change, not once at load, so
        // a migration that fired twice would multiply a release by a million.
        const once = sanitizeTrackSnapshot(storedProjectWithLimiter(0.1));
        const twice = sanitizeTrackSnapshot(once);
        expect(twice.tracks[0]?.devices[0]?.parameterValues.release).toBe(100);
    });

    it('needs no migration for ceiling, whose declared range never narrowed', () => {
        // -12..0 before and after, so every stored ceiling was already legal.
        const ceiling = getPluginById('faust-brick-wall-limiter')?.parameters.find(
            (parameter) => parameter.id === 'ceiling'
        );
        expect(ceiling?.minValue).toBe(-12);
        expect(ceiling?.maxValue).toBe(0);
        const restored = sanitizeTrackSnapshot(storedProjectWithLimiter(0.1));
        expect(restored.tracks[0]?.devices[0]?.parameterValues.ceiling).toBe(-0.3);
    });

    it('has no stored lookahead to migrate, because the parameter is new', () => {
        // A project written before this catalog entry existed cannot hold a
        // value for it, and the descriptor default is what `addDevice` seeds.
        const restored = sanitizeTrackSnapshot(storedProjectWithLimiter(0.1));
        expect(restored.tracks[0]?.devices[0]?.parameterValues.lookahead).toBeUndefined();
        expect(
            getPluginById('faust-brick-wall-limiter')?.parameters.find((parameter) => parameter.id === 'lookahead')
                ?.defaultValue
        ).toBe(5);
    });
});

/**
 * The built-in compressor's Auto Makeup switch is new. A new device starts
 * with it off, but every compressor stored before it existed sounded with the
 * browser's makeup gain, so a stored record without the key loads as on.
 */
function storedProjectWithDevices(devices: readonly Record<string, unknown>[]): unknown {
    return {
        tracks: [
            {
                id: 'track-1',
                name: 'Vocal',
                kind: 'audio',
                devices: devices.map((device, index) => ({
                    id: `dev-${index}`,
                    name: String(device.type),
                    bypassed: false,
                    ...device,
                })),
            },
        ],
        selectedTrackId: 'track-1',
    };
}

const LEGACY_COMPRESSOR_VALUES = {
    'comp-threshold': -18,
    'comp-ratio': 3,
    'comp-attack': 10,
    'comp-release': 100,
    'comp-knee': 6,
    'comp-makeup': 2,
};

function loadedDevices(snapshot: unknown): Array<Record<string, number>> {
    return sanitizeTrackSnapshot(snapshot).tracks[0]!.devices.map((device) => device.parameterValues);
}

describe('stored built-in compressor reads Auto Makeup as on when the record predates it', () => {
    it('loads a compressor stored without the key with the switch on and every other value as stored', () => {
        const [values] = loadedDevices(
            storedProjectWithDevices([{ type: 'builtin-compressor', parameterValues: LEGACY_COMPRESSOR_VALUES }])
        );
        expect(values).toEqual({ ...LEGACY_COMPRESSOR_VALUES, 'comp-auto-makeup': 1 });
    });

    it.each([0, 1])('keeps a stored switch value of %d', (stored) => {
        const [values] = loadedDevices(
            storedProjectWithDevices([
                {
                    type: 'builtin-compressor',
                    parameterValues: { ...LEGACY_COMPRESSOR_VALUES, 'comp-auto-makeup': stored },
                },
            ])
        );
        expect(values?.['comp-auto-makeup']).toBe(stored);
    });

    it('is idempotent across repeated projections', () => {
        const once = sanitizeTrackSnapshot(
            storedProjectWithDevices([{ type: 'builtin-compressor', parameterValues: LEGACY_COMPRESSOR_VALUES }])
        );
        const twice = sanitizeTrackSnapshot(once);
        expect(twice.tracks[0]?.devices[0]?.parameterValues).toEqual({
            ...LEGACY_COMPRESSOR_VALUES,
            'comp-auto-makeup': 1,
        });
    });

    it('fills nothing on devices of another type, the sidechain compressor included', () => {
        const scValues = { 'sc-comp-threshold': -20, 'sc-comp-ratio': 4 };
        const eqValues = { 'eq-low-gain': 1 };
        const [sidechain, eq] = loadedDevices(
            storedProjectWithDevices([
                { type: 'builtin-sidechain-compressor', parameterValues: scValues },
                { type: 'builtin-eq', parameterValues: eqValues },
            ])
        );
        expect(sidechain).toEqual(scValues);
        expect(eq).toEqual(eqValues);
    });

    it('returns the same record when nothing applies, and still rescales the limiter release', () => {
        const withSwitch = { ...LEGACY_COMPRESSOR_VALUES, 'comp-auto-makeup': 0 };
        expect(migrateStoredDeviceParameterValues('builtin-compressor', withSwitch)).toBe(withSwitch);
        expect(migrateStoredDeviceParameterValues('faust-brick-wall-limiter', { release: 0.1 })).toEqual({
            release: 100,
        });
    });

    it('places a newly added compressor with the switch off, and loading it keeps it off', () => {
        const plugin = getPluginById('builtin-compressor');
        expect(plugin?.parameters.find((candidate) => candidate.id === 'comp-auto-makeup')).toMatchObject({
            type: 'bool',
            defaultValue: 0,
            automatable: false,
        });
        const added = composeAddedDeviceParameterValues(plugin);
        expect(added['comp-auto-makeup']).toBe(0);
        const [values] = loadedDevices(
            storedProjectWithDevices([{ type: 'builtin-compressor', parameterValues: added }])
        );
        expect(values?.['comp-auto-makeup']).toBe(0);
    });
});

const LEGACY_LIMITER_VALUES = { 'lim-threshold': -24, 'lim-release': 100, 'lim-ceiling': -0.3 };

describe('stored built-in limiter reads Auto Makeup as on when the record predates it (ADR 0066)', () => {
    it('loads a limiter stored without the key with the switch on and every other value as stored', () => {
        const [values] = loadedDevices(
            storedProjectWithDevices([{ type: 'builtin-limiter', parameterValues: LEGACY_LIMITER_VALUES }])
        );
        expect(values).toEqual({ ...LEGACY_LIMITER_VALUES, 'lim-auto-makeup': 1 });
    });

    it.each([0, 1])('keeps a stored switch value of %d', (stored) => {
        const [values] = loadedDevices(
            storedProjectWithDevices([
                { type: 'builtin-limiter', parameterValues: { ...LEGACY_LIMITER_VALUES, 'lim-auto-makeup': stored } },
            ])
        );
        expect(values?.['lim-auto-makeup']).toBe(stored);
    });

    it('fills neither switch on the other device, nor on the Faust brick-wall limiter', () => {
        const [limiterValues, compressorValues, faust] = loadedDevices(
            storedProjectWithDevices([
                { type: 'builtin-limiter', parameterValues: LEGACY_LIMITER_VALUES },
                { type: 'builtin-compressor', parameterValues: LEGACY_COMPRESSOR_VALUES },
                { type: 'faust-brick-wall-limiter', parameterValues: { ceiling: -1, release: 100 } },
            ])
        );
        expect(limiterValues?.['comp-auto-makeup']).toBeUndefined();
        expect(compressorValues?.['lim-auto-makeup']).toBeUndefined();
        expect(faust).toEqual({ ceiling: -1, release: 100 });
    });

    it('places a newly added limiter with the switch off, and loading it keeps it off', () => {
        const plugin = getPluginById('builtin-limiter');
        expect(plugin?.parameters.find((candidate) => candidate.id === 'lim-auto-makeup')).toMatchObject({
            type: 'bool',
            defaultValue: 0,
            automatable: false,
        });
        const added = composeAddedDeviceParameterValues(plugin);
        expect(added['lim-auto-makeup']).toBe(0);
        const [values] = loadedDevices(storedProjectWithDevices([{ type: 'builtin-limiter', parameterValues: added }]));
        expect(values?.['lim-auto-makeup']).toBe(0);
    });

    it('encodes the limiter switch on as absence and off as 0', () => {
        expect(
            encodeStoredDeviceParameterValues('builtin-limiter', { ...LEGACY_LIMITER_VALUES, 'lim-auto-makeup': 1 })
        ).toEqual(LEGACY_LIMITER_VALUES);
        const off = { ...LEGACY_LIMITER_VALUES, 'lim-auto-makeup': 0 };
        expect(encodeStoredDeviceParameterValues('builtin-limiter', off)).toBe(off);
    });
});

/**
 * The fill runs on the CRDT projection, and the store writes its projected
 * value back through the reconciler. Without a stored encoding symmetric with
 * the fill, the first unrelated write to a track would land the filled key in
 * the document of every legacy compressor. These rows drive the real store
 * against a real Automerge document and read the document itself.
 */
type RootDocument = Record<string, unknown> & { tracks?: { tracks: Track[] } };

function attachDocument(initial: Doc<RootDocument>): { read: () => Doc<RootDocument> } {
    let doc = initial;
    configureAutomergeStoragePort({
        getDoc: () => doc,
        getSemanticMessage: () => undefined,
        hasDoc: (docId: string) => docId === 'root',
        mutateDoc: ({ changeFn }) => {
            doc = change(doc, (draft) => changeFn(draft));
        },
    });
    resetAutomergeStorageProjections('root');
    trackStore.hydrate();
    return { read: () => doc };
}

function legacyDocument(): Doc<RootDocument> {
    const track = createTrack({ id: 'track-1', name: 'Vocal', kind: 'audio' });
    return from<RootDocument>({
        tracks: {
            tracks: [
                {
                    ...track,
                    devices: [
                        {
                            id: 'dev-comp',
                            name: 'Compressor',
                            type: 'builtin-compressor',
                            bypassed: false,
                            parameterValues: LEGACY_COMPRESSOR_VALUES,
                        },
                        {
                            id: 'dev-eq',
                            name: 'EQ',
                            type: 'builtin-eq',
                            bypassed: false,
                            parameterValues: { 'eq-low-gain': 1 },
                        },
                    ],
                },
            ],
        },
    });
}

function editTracks(edit: (track: Track) => Track): void {
    const state = trackStore.value;
    if (!state) {
        throw new Error('trackStore must hold a projected value');
    }
    trackStore.set({ ...state, tracks: state.tracks.map(edit) });
    flushAutomergeStorageWrites();
}

function setSwitch(value: number): void {
    const withSwitch = (device: Track['devices'][number]): Track['devices'][number] => {
        if (device.id !== 'dev-comp') {
            return device;
        }
        return { ...device, parameterValues: { ...device.parameterValues, 'comp-auto-makeup': value } };
    };
    editTracks((track) => ({ ...track, devices: track.devices.map(withSwitch) }));
}

function storedValues(doc: Doc<RootDocument>, deviceId: string): Record<string, number> | undefined {
    return doc.tracks?.tracks[0]?.devices.find((candidate) => candidate.id === deviceId)?.parameterValues;
}

function projectedSwitch(): number | undefined {
    return trackStore.value?.tracks[0]?.devices.find((device) => device.id === 'dev-comp')?.parameterValues[
        'comp-auto-makeup'
    ];
}

afterEach(() => {
    flushAutomergeStorageWrites();
    configureAutomergeStoragePort(null);
});

describe('the document stores Auto Makeup on as absence, symmetric with the fill', () => {
    it('leaves a legacy compressor without the key when an unrelated track write lands', () => {
        const document = attachDocument(legacyDocument());
        expect(projectedSwitch()).toBe(1);

        editTracks((track) => ({ ...track, gain: 0.5 }));

        expect(document.read().tracks?.tracks[0]?.gain).toBe(0.5);
        expect(storedValues(document.read(), 'dev-comp')).toEqual(LEGACY_COMPRESSOR_VALUES);
        expect(projectedSwitch()).toBe(1);
    });

    it('stores 0 when the switch is set off, and removes the key when it is set on again', () => {
        const document = attachDocument(legacyDocument());

        setSwitch(0);
        expect(storedValues(document.read(), 'dev-comp')).toEqual({
            ...LEGACY_COMPRESSOR_VALUES,
            'comp-auto-makeup': 0,
        });
        expect(projectedSwitch()).toBe(0);

        setSwitch(1);
        expect(storedValues(document.read(), 'dev-comp')).toEqual(LEGACY_COMPRESSOR_VALUES);
        expect(projectedSwitch()).toBe(1);
    });

    it('stores a non-compressor device exactly as written', () => {
        const document = attachDocument(legacyDocument());

        editTracks((track) => ({ ...track, gain: 0.5 }));

        expect(storedValues(document.read(), 'dev-eq')).toEqual({ 'eq-low-gain': 1 });
    });

    it('encodes only a fill key at its legacy value, and returns the record untouched otherwise', () => {
        const off = { ...LEGACY_COMPRESSOR_VALUES, 'comp-auto-makeup': 0 };
        expect(encodeStoredDeviceParameterValues('builtin-compressor', off)).toBe(off);
        expect(encodeStoredDeviceParameterValues('builtin-compressor', LEGACY_COMPRESSOR_VALUES)).toBe(
            LEGACY_COMPRESSOR_VALUES
        );
        const onForOtherType = { 'comp-auto-makeup': 1 };
        expect(encodeStoredDeviceParameterValues('builtin-sidechain-compressor', onForOtherType)).toBe(onForOtherType);
        expect(
            encodeStoredDeviceParameterValues('builtin-compressor', {
                ...LEGACY_COMPRESSOR_VALUES,
                'comp-auto-makeup': 1,
            })
        ).toEqual(LEGACY_COMPRESSOR_VALUES);
    });
});
