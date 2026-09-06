/**
 * The store binding for the live automation projection, and specifically what
 * it does with the composition-root seam that carries Arrangement's
 * hosted-plugin law (#3568).
 *
 * AudioEngine may not import `Arrangement/useCases`, so the law arrives through
 * `offlineDeviceParameterLawState`, which the composition root fills. An unset
 * seam is not "no law to apply" — it is a projection that cannot tell an
 * automatable plugin parameter from one the plugin never declared, and cannot
 * clamp what it stamps to the instance's published bounds. Admitting a
 * parameter on that footing sends the engine a value nobody bounded, for an id
 * nobody accepted.
 *
 * The projection arithmetic itself belongs to `projectLiveAutomationWrites` and
 * is pinned there; what this file owns is which law reaches it.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { type Device, type Track } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';

import { offlineDeviceParameterLawState } from '../../../repositories/offlineScheduler/offlineDeviceParameterLawState';
import {
    offlinePpqEndpointProjectorState,
    type OfflinePpqEndpointProjector,
} from '../../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { readLiveAutomationWrites } from '../readLiveAutomationWrites';

const SAMPLE_RATE = 48_000;
const SECONDS_PER_BEAT = 0.5;

/** Flat 120 BPM, which is the tempo an unset transport store answers with. */
const projectPpqEndpoints: OfflinePpqEndpointProjector = ({ startPpq, endPpq, sampleRate }) => {
    const startSamples = Math.round(startPpq * SECONDS_PER_BEAT * sampleRate);
    const endSamples = Math.round(endPpq * SECONDS_PER_BEAT * sampleRate);
    return {
        startSamples,
        endSamples,
        durationSamples: endSamples - startSamples,
        startSeconds: startSamples / sampleRate,
        endSeconds: endSamples / sampleRate,
        durationSeconds: (endSamples - startSamples) / sampleRate,
    };
};

const HOSTED_DEVICE: Device = {
    id: 'plugin-1',
    name: 'Compressor',
    type: 'external-plugin',
    bypassed: false,
    parameterValues: {},
    externalInstanceId: 'instance-1',
};

const TRACK: Track = {
    id: 'track-1',
    name: 'Track 1',
    kind: 'audio',
    muted: false,
    soloed: false,
    armed: false,
    gain: 0.8,
    pan: 0,
    color: '#ff0000',
    clips: [],
    devices: [HOSTED_DEVICE],
    sends: [],
    frozen: false,
    freezeState: { status: 'unfrozen' },
    parentId: null,
    collapsed: false,
    inputMonitoring: 'auto',
    hidden: false,
    disabled: false,
    height: 80,
    outputId: 'hw_out',
    automationMode: 'read',
    groupId: null,
    soloSafe: false,
    notes: '',
    inputId: null,
    activeAlternativeId: 'alt-1',
    alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
    vcaGroupId: null,
    midiOutputTrackId: null,
    followChordTrack: false,
    midiFx: [],
};

/** The lane shape the store holds, which is the one this reader takes them from. */
type StoredAutomationLane = NonNullable<typeof automationStore.value>['lanes'][number];

/** A lane on the plugin's own parameter 7, which is how a hosted id is spelled. */
const HOSTED_LANE: StoredAutomationLane = {
    id: 'lane-plugin-7',
    trackId: TRACK.id,
    parameterId: 'plugin-1:7',
    parameterName: 'plugin-1:7',
    enabled: true,
    visible: true,
    collapsed: false,
    objects: [],
    minValue: 0,
    maxValue: 1,
    points: [
        { beat: 0, value: 0.2, curve: 'step', tension: 0 },
        { beat: 2, value: 0.8, curve: 'step', tension: 0 },
    ],
};

/** The lane the filled seam refuses: a parameter id this plugin never declared. */
const UNDECLARED_LANE: StoredAutomationLane = {
    ...HOSTED_LANE,
    id: 'lane-plugin-9',
    parameterId: 'plugin-1:9',
    parameterName: 'plugin-1:9',
};

/** The ceiling the filled seam publishes, below what {@link HOSTED_LANE} asks for. */
const PUBLISHED_CEILING = 0.5;

/**
 * A seam that can say no.
 *
 * An accept-all predicate and an identity clamp would let every case in this
 * file pass whether the projection consulted the law or ignored it — the whole
 * point of the seam is that Arrangement, not AudioEngine, decides which ids are
 * automatable and what bounds their values are held to. So this one accepts a
 * single declared id and publishes a ceiling the lane's own curve exceeds.
 */
function fillSeam(): void {
    offlineDeviceParameterLawState.acceptsExternalPluginParameter = (_instanceId, parameterId) => parameterId === '7';
    offlineDeviceParameterLawState.clampExternalPluginValue = ({ value }) => Math.min(value, PUBLISHED_CEILING);
    offlineDeviceParameterLawState.quantiseValue = ({ value }) => value;
}

/**
 * The stamped values one hosted parameter's entry carries, in order. Steps
 * only, because a step is the one shape a device parameter has a meaning for.
 */
function hostedValues(result: ReturnType<typeof readLiveAutomationWrites>, parameterId: string): readonly number[] {
    const entry = result.entries.find(
        (candidate) => candidate.target.kind === 'device-parameter' && candidate.target.parameterId === parameterId
    );
    return (entry?.writes ?? []).flatMap((write) => (write.shape === 'step' ? [write.value] : []));
}

function emptySeam(): void {
    offlineDeviceParameterLawState.acceptsExternalPluginParameter = null;
    offlineDeviceParameterLawState.clampExternalPluginValue = null;
    offlineDeviceParameterLawState.isAutomatable = null;
    offlineDeviceParameterLawState.clampValue = null;
    offlineDeviceParameterLawState.quantiseValue = null;
}

/**
 * A seam the composition root has only started filling: the admission half is
 * there and the value halves are not.
 *
 * All-set and all-null are the two cases that cannot tell the seam's rule
 * apart, because a projection admitting a parameter whenever *any* half is set
 * answers both of them identically. This is the shape the rule is actually
 * about — a parameter that would be accepted with nothing to bound the value it
 * stamps.
 */
function halfFilledSeam(): void {
    emptySeam();
    offlineDeviceParameterLawState.acceptsExternalPluginParameter = (_instanceId, parameterId) => parameterId === '7';
}

/**
 * The other half-filled shape: the value halves are there and the admission
 * half is not.
 *
 * The guard has one term per half, and a missing term is invisible while every
 * case that exercises it also drops another. This is the one that isolates the
 * admission term — a projection that read only the clamp and the quantiser
 * would stamp every id the lane names, including ones the instance never
 * declared.
 */
function valueOnlySeam(): void {
    emptySeam();
    offlineDeviceParameterLawState.clampExternalPluginValue = ({ value }) => Math.min(value, PUBLISHED_CEILING);
    offlineDeviceParameterLawState.quantiseValue = ({ value }) => value;
}

/**
 * A third missing shape: only the clamp is absent.
 *
 * The guard's three terms are independent — a missing clamp is invisible to a
 * check that only ever drops the admission term alongside it. This isolates
 * the clamp: a projection that read only accepts and quantise would stamp a
 * value nothing has bounded to the instance's published range.
 */
function clampMissingSeam(): void {
    emptySeam();
    offlineDeviceParameterLawState.acceptsExternalPluginParameter = (_instanceId, parameterId) => parameterId === '7';
    offlineDeviceParameterLawState.quantiseValue = ({ value }) => value;
}

/**
 * The fourth missing shape: only the quantiser is absent.
 *
 * Isolates the quantise term the same way {@link clampMissingSeam} isolates
 * the clamp — a projection that read only accepts and clamp would stamp a
 * value nothing has quantised to the parameter's declared grain.
 */
function quantiseMissingSeam(): void {
    emptySeam();
    offlineDeviceParameterLawState.acceptsExternalPluginParameter = (_instanceId, parameterId) => parameterId === '7';
    offlineDeviceParameterLawState.clampExternalPluginValue = ({ value }) => Math.min(value, PUBLISHED_CEILING);
}

function readOneRegion(): ReturnType<typeof readLiveAutomationWrites> {
    return readLiveAutomationWrites({
        stripTracks: [TRACK],
        sampleRate: SAMPLE_RATE,
        regionStartSeconds: 0,
        regionEndSeconds: 4,
    });
}

beforeEach(() => {
    offlinePpqEndpointProjectorState.project = projectPpqEndpoints;
    automationStore.set({ lanes: [HOSTED_LANE, UNDECLARED_LANE] });
    // The session is sounding this plugin: the two other conditions a hosted
    // parameter needs are met, so the seam is the only thing left to decide it.
    nativeLiveGraphSession.carriedStripIds = new Set([TRACK.id]);
    nativeLiveGraphSession.nativeChainByStripId = new Map([[TRACK.id, [HOSTED_DEVICE.id]]]);
});

afterEach(() => {
    offlinePpqEndpointProjectorState.project = null;
    emptySeam();
    automationStore.set({ lanes: [] });
    nativeLiveGraphSession.carriedStripIds = new Set();
    nativeLiveGraphSession.nativeChainByStripId = new Map();
});

describe('readLiveAutomationWrites', () => {
    it('carries a hosted plugin lane once the composition root has filled the parameter-law seam', () => {
        fillSeam();

        const result = readOneRegion();

        expect(result.entries.find((entry) => entry.target.kind === 'device-parameter')?.target).toEqual({
            kind: 'device-parameter',
            trackId: TRACK.id,
            deviceId: HOSTED_DEVICE.id,
            parameterId: '7',
        });
    });

    it('admits no lane for a parameter id the seam’s law refuses', () => {
        fillSeam();

        const result = readOneRegion();

        expect(hostedValues(result, '9')).toEqual([]);
        expect(result.exclusions.some((exclusion) => exclusion.subjectId === UNDECLARED_LANE.id)).toBe(true);
    });

    it('stamps the value the seam’s clamp published, not the one the curve asked for', () => {
        fillSeam();

        const values = hostedValues(readOneRegion(), '7');

        // The lane rides from 0.2 to 0.8; the instance publishes 0.5 as its
        // ceiling, and the ceiling is what the engine may be stamped.
        expect(values).not.toHaveLength(0);
        expect(Math.max(...values)).toBe(PUBLISHED_CEILING);
    });

    it('admits no hosted plugin lane while the parameter-law seam is unset', () => {
        emptySeam();

        const result = readOneRegion();

        expect(result.entries.some((entry) => entry.target.kind === 'device-parameter')).toBe(false);
    });

    it('admits no hosted plugin lane while any half of the parameter-law seam is unset', () => {
        halfFilledSeam();

        const result = readOneRegion();

        expect(result.entries.some((entry) => entry.target.kind === 'device-parameter')).toBe(false);
    });

    it('admits no hosted plugin lane while only the value halves of the seam are set', () => {
        valueOnlySeam();

        const result = readOneRegion();

        expect(result.entries.some((entry) => entry.target.kind === 'device-parameter')).toBe(false);
    });

    it('admits no hosted plugin lane while only the clamp half of the seam is unset', () => {
        clampMissingSeam();

        const result = readOneRegion();

        expect(result.entries.some((entry) => entry.target.kind === 'device-parameter')).toBe(false);
    });

    it('admits no hosted plugin lane while only the quantise half of the seam is unset', () => {
        quantiseMissingSeam();

        const result = readOneRegion();

        expect(result.entries.some((entry) => entry.target.kind === 'device-parameter')).toBe(false);
    });
});

/**
 * The other family the engine can be stamped for (#3893): a built-in whose body
 * `daw-engine` builds, admitted on the device *type*'s declared law rather than
 * on a plugin instance's, and addressed in the vocabulary that body answers to
 * rather than the one project truth stores.
 */
describe('readLiveAutomationWrites — carried built-in devices', () => {
    const FERMENTER_DEVICE: Device = {
        id: 'd1',
        name: 'Fermenter',
        type: 'fermenter',
        bypassed: false,
        parameterValues: { filterCutoff: 0.4 },
    };

    /** `DeviceParam::from_name`'s own vocabulary, which is Knead's project id too. */
    const KNEAD_PARAMETER_ID = 'shift_semitones';

    const KNEAD_DEVICE: Device = {
        id: 'd2',
        name: 'Knead',
        type: 'knead',
        bypassed: false,
        parameterValues: { [KNEAD_PARAMETER_ID]: 0 },
    };

    const FERMENTER_LANE: StoredAutomationLane = {
        ...HOSTED_LANE,
        id: 'lane-d1-filterCutoff',
        parameterId: 'd1:filterCutoff',
        parameterName: 'd1:filterCutoff',
    };

    const KNEAD_LANE: StoredAutomationLane = {
        ...HOSTED_LANE,
        id: 'lane-d2-shift',
        parameterId: `d2:${KNEAD_PARAMETER_ID}`,
        parameterName: `d2:${KNEAD_PARAMETER_ID}`,
    };

    /** The built-in half of the seam: the device type's own declared law. */
    function fillBuiltinSeam(accepts: (paramId: string) => boolean = () => true): void {
        offlineDeviceParameterLawState.isAutomatable = ({ paramId }) => accepts(paramId);
        offlineDeviceParameterLawState.clampValue = ({ value }) => value;
        offlineDeviceParameterLawState.quantiseValue = ({ value }) => value;
    }

    function carry(devices: readonly Device[]): void {
        automationStore.set({ lanes: [FERMENTER_LANE, KNEAD_LANE] });
        nativeLiveGraphSession.carriedStripIds = new Set([TRACK.id]);
        nativeLiveGraphSession.nativeChainByStripId = new Map([[TRACK.id, devices.map((device) => device.id)]]);
    }

    function readStrip(devices: readonly Device[]): ReturnType<typeof readLiveAutomationWrites> {
        return readLiveAutomationWrites({
            stripTracks: [{ ...TRACK, devices: [...devices] }],
            sampleRate: SAMPLE_RATE,
            regionStartSeconds: 0,
            regionEndSeconds: 4,
        });
    }

    function deviceTargets(
        result: ReturnType<typeof readLiveAutomationWrites>
    ): readonly { deviceId: string; parameterId: string }[] {
        return result.entries.flatMap((entry) =>
            entry.target.kind === 'device-parameter'
                ? [{ deviceId: entry.target.deviceId, parameterId: entry.target.parameterId }]
                : []
        );
    }

    it('stamps a carried Fermenter lane under the name the instrument answers to', () => {
        fillBuiltinSeam();
        carry([FERMENTER_DEVICE]);

        const result = readStrip([FERMENTER_DEVICE]);

        // The lane is authored `filterCutoff`; `builtin_parameter` resolves the
        // instrument's own `cutoff`, and a stamp under the stored id has no
        // native address at all.
        expect(result.entries.find((entry) => entry.target.kind === 'device-parameter')?.target).toEqual({
            kind: 'device-parameter',
            trackId: TRACK.id,
            deviceId: FERMENTER_DEVICE.id,
            parameterId: 'cutoff',
        });
    });

    // Knead's ids are already the engine's names, so its entry must come back
    // untouched — a translation applied to every body would break this one.
    it('stamps a carried Knead lane under the id the project stores', () => {
        fillBuiltinSeam();
        carry([KNEAD_DEVICE]);

        const result = readStrip([KNEAD_DEVICE]);

        expect(deviceTargets(result)).toEqual([{ deviceId: KNEAD_DEVICE.id, parameterId: KNEAD_PARAMETER_ID }]);
    });

    it('admits no built-in lane the seam’s automatable predicate refuses', () => {
        fillBuiltinSeam((paramId) => paramId !== KNEAD_PARAMETER_ID);
        carry([KNEAD_DEVICE]);

        const result = readStrip([KNEAD_DEVICE]);

        expect(deviceTargets(result)).toEqual([]);
    });

    // The two halves answer different questions and arrive independently, so a
    // seam holding one of them must admit that family and refuse the other —
    // not gate both on all five functions.
    it('admits the hosted device while the built-in half of the seam is unset', () => {
        fillSeam();
        carry([HOSTED_DEVICE, FERMENTER_DEVICE]);
        automationStore.set({ lanes: [HOSTED_LANE, FERMENTER_LANE] });

        const result = readStrip([HOSTED_DEVICE, FERMENTER_DEVICE]);

        expect(deviceTargets(result)).toEqual([{ deviceId: HOSTED_DEVICE.id, parameterId: '7' }]);
    });

    it('admits the built-in while the hosted half of the seam is unset', () => {
        fillBuiltinSeam();
        carry([HOSTED_DEVICE, FERMENTER_DEVICE]);
        automationStore.set({ lanes: [HOSTED_LANE, FERMENTER_LANE] });

        const result = readStrip([HOSTED_DEVICE, FERMENTER_DEVICE]);

        expect(deviceTargets(result)).toEqual([{ deviceId: FERMENTER_DEVICE.id, parameterId: 'cutoff' }]);
    });

    // A built-in's bounds are the device type's declared range, which the
    // hosted clamp cannot answer for: it is asked of an instance, and this
    // device has none.
    it('holds a built-in’s stamped values to the seam’s type clamp, never the instance clamp', () => {
        fillBuiltinSeam();
        offlineDeviceParameterLawState.clampValue = ({ value }) => Math.min(value, 1);
        offlineDeviceParameterLawState.clampExternalPluginValue = () => 99;
        carry([FERMENTER_DEVICE]);
        automationStore.set({
            lanes: [
                {
                    ...FERMENTER_LANE,
                    maxValue: 5,
                    points: [
                        { beat: 0, value: 0.2, curve: 'step', tension: 0 },
                        { beat: 2, value: 5, curve: 'step', tension: 0 },
                    ],
                },
            ],
        });

        const values = hostedValues(readStrip([FERMENTER_DEVICE]), 'cutoff');

        // The curve rides to 5; the type law's ceiling is 1, and the instance
        // clamp — which has no instance to answer for here — would say 99.
        expect(values).not.toHaveLength(0);
        expect(Math.max(...values)).toBe(1);
    });

    // The stamped route is for what the engine is actually sounding. A built-in
    // no splice has placed in the native chain is still Web Audio's.
    it('admits no lane for a built-in this session does not carry', () => {
        fillBuiltinSeam();
        carry([]);

        const result = readStrip([FERMENTER_DEVICE]);

        expect(deviceTargets(result)).toEqual([]);
    });

    // The descriptor law fails open on a name its descriptor never declares —
    // Knead's own descriptor declares no parameters at all — so an accept-all
    // law is exactly the case that would let a lane the device does not hold
    // through if the presence check were missing (#3893).
    it('refuses a carried Knead lane the device does not hold', () => {
        const KNEAD_WITHOUT_PARAMETERS: Device = { ...KNEAD_DEVICE, parameterValues: {} };
        fillBuiltinSeam();
        carry([KNEAD_WITHOUT_PARAMETERS]);

        const result = readStrip([KNEAD_WITHOUT_PARAMETERS]);

        expect(deviceTargets(result)).toEqual([]);
    });

    // Presence on the device is not enough either: the device can hold a key
    // the body still cannot resolve into a name the engine parses
    // (`DeviceParam::from_name`) or expands (`builtin_parameter`), and that
    // name would refuse the whole `write-device-parameter` batch it travels in.
    it('refuses a parameter the body does not resolve even when the device holds it', () => {
        const FERMENTER_WITH_BOGUS: Device = {
            ...FERMENTER_DEVICE,
            parameterValues: { filterCutoff: 0.4, bogus: 1 },
        };
        const BOGUS_LANE: StoredAutomationLane = {
            ...HOSTED_LANE,
            id: 'lane-d1-bogus',
            parameterId: 'd1:bogus',
            parameterName: 'd1:bogus',
        };
        fillBuiltinSeam();
        carry([FERMENTER_WITH_BOGUS]);
        automationStore.set({ lanes: [BOGUS_LANE] });

        const result = readStrip([FERMENTER_WITH_BOGUS]);

        expect(deviceTargets(result)).toEqual([]);
    });

    /** The hosted half of the seam, accepting one chosen parameter id rather than {@link HOSTED_LANE}'s fixed `'7'`. */
    function fillHostedSeamAccepting(parameterId: string): void {
        offlineDeviceParameterLawState.acceptsExternalPluginParameter = (_instanceId, candidateId) =>
            candidateId === parameterId;
        offlineDeviceParameterLawState.clampExternalPluginValue = ({ value }) => value;
        offlineDeviceParameterLawState.quantiseValue = ({ value }) => value;
    }

    // A camelCase hosted id is exactly what the Fermenter translator would
    // visibly mangle (`driveAmount` -> `drive_amount`) if it were ever applied
    // to the wrong device on the strip — the regression `addressedNatively`
    // must resolve each entry's own device for, not the strip's first built-in.
    it('re-addresses only the built-in when a hosted device shares the strip', () => {
        const HOSTED_DRIVE_LANE: StoredAutomationLane = {
            ...HOSTED_LANE,
            id: 'lane-plugin-driveAmount',
            parameterId: `${HOSTED_DEVICE.id}:driveAmount`,
            parameterName: `${HOSTED_DEVICE.id}:driveAmount`,
        };
        fillHostedSeamAccepting('driveAmount');
        fillBuiltinSeam();
        carry([HOSTED_DEVICE, FERMENTER_DEVICE]);
        automationStore.set({ lanes: [HOSTED_DRIVE_LANE, FERMENTER_LANE] });

        const result = readStrip([HOSTED_DEVICE, FERMENTER_DEVICE]);

        expect(deviceTargets(result)).toHaveLength(2);
        expect(deviceTargets(result)).toEqual(
            expect.arrayContaining([
                { deviceId: HOSTED_DEVICE.id, parameterId: 'driveAmount' },
                { deviceId: FERMENTER_DEVICE.id, parameterId: 'cutoff' },
            ])
        );
    });
});
