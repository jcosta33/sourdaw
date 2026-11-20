import { trackStore } from '#/modules/Arrangement/stores';
import { GAIN_TRIM_DB } from '#/utils/audioLevelLaw';
import { valuesEqual } from '#/utils/structuralEquality';

import { GLUTEN_PARAM_IDS } from '../../models/GlutenParamIds';
import {
    clampOversampling,
    DEFAULT_PATCH,
    SC_LPF_FREQ_RANGE,
    type GlutenPatch,
    type GlutenTopology,
} from '../../models/GlutenPatch';
import { getGlutenState, loadGlutenPatch } from '../../stores/glutenStore';

const TOPOLOGIES = ['vca', 'opto', 'fet', 'diode'] as const;
const STYLES = ['glue', 'punch', 'smooth', 'pump'] as const;
const STEREO_MODES = ['stereo', 'mid', 'side', 'dual-mono'] as const;

const NUMERIC_FIELDS = [
    GLUTEN_PARAM_IDS.amount,
    GLUTEN_PARAM_IDS.threshold,
    GLUTEN_PARAM_IDS.ratio,
    GLUTEN_PARAM_IDS.attack,
    GLUTEN_PARAM_IDS.release,
    GLUTEN_PARAM_IDS.knee,
    GLUTEN_PARAM_IDS.makeup,
    GLUTEN_PARAM_IDS.mix,
    GLUTEN_PARAM_IDS.range,
    GLUTEN_PARAM_IDS.scHpfFreq,
    GLUTEN_PARAM_IDS.thrust,
    GLUTEN_PARAM_IDS.stereoLink,
    GLUTEN_PARAM_IDS.oversampling,
    GLUTEN_PARAM_IDS.lookahead,
    GLUTEN_PARAM_IDS.scLpfFreq,
    GLUTEN_PARAM_IDS.scEqFreq,
    GLUTEN_PARAM_IDS.scEqGain,
    GLUTEN_PARAM_IDS.scEqQ,
    GLUTEN_PARAM_IDS.inputGain,
    GLUTEN_PARAM_IDS.outputGain,
    GLUTEN_PARAM_IDS.xfmrDrive,
    GLUTEN_PARAM_IDS.recovery,
    GLUTEN_PARAM_IDS.vcaType,
    GLUTEN_PARAM_IDS.vcaCharacter,
    GLUTEN_PARAM_IDS.jfetK3,
    GLUTEN_PARAM_IDS.xfmrK2,
    GLUTEN_PARAM_IDS.blendAmount,
] as const satisfies readonly (keyof GlutenPatch)[];

const BOOLEAN_FIELDS = [
    GLUTEN_PARAM_IDS.autoMakeup,
    GLUTEN_PARAM_IDS.autoRelease,
    GLUTEN_PARAM_IDS.scHpfEnabled,
    GLUTEN_PARAM_IDS.scLpfEnabled,
    GLUTEN_PARAM_IDS.scEqEnabled,
    GLUTEN_PARAM_IDS.deltaListen,
    GLUTEN_PARAM_IDS.gainMatchBypass,
    GLUTEN_PARAM_IDS.extSidechain,
    GLUTEN_PARAM_IDS.allButtons,
    GLUTEN_PARAM_IDS.limitMode,
    GLUTEN_PARAM_IDS.feedForward,
] as const satisfies readonly (keyof GlutenPatch)[];

function rustU8(value: number): number {
    return Math.min(255, Math.max(0, Math.trunc(value)));
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

type NumericField = (typeof NUMERIC_FIELDS)[number];

const NUMERIC_NORMALIZERS = {
    amount: (value) => clamp(value, 0, 100),
    threshold: (value) => clamp(value, -60, 0),
    ratio: (value) => clamp(value, 1, 20),
    attack: (value) => clamp(value, 0.02, 250),
    release: (value) => clamp(value, 25, 5000),
    knee: (value) => clamp(value, 0, 30),
    makeup: (value) => clamp(value, -12, 24),
    mix: (value) => clamp(value, 0, 1),
    range: (value) => clamp(value, 0, 60),
    scHpfFreq: (value) => clamp(value, 20, 500),
    thrust: (value) => Math.min(2, rustU8(value)),
    stereoLink: (value) => clamp(value, 0, 1),
    oversampling: (value) => clampOversampling(rustU8(value)),
    lookahead: (value) => clamp(value, 0, 20),
    scLpfFreq: (value) => clamp(value, SC_LPF_FREQ_RANGE.min, SC_LPF_FREQ_RANGE.max),
    scEqFreq: (value) => clamp(value, 20, 20000),
    scEqGain: (value) => clamp(value, -18, 18),
    scEqQ: (value) => clamp(value, 0.1, 10),
    inputGain: (value) => clamp(value, -12, 24),
    outputGain: (value) => clamp(value, GAIN_TRIM_DB.min, GAIN_TRIM_DB.max),
    xfmrDrive: (value) => clamp(value, 0, 3),
    recovery: (value) => clamp(rustU8(value), 1, 5),
    vcaType: (value) => clamp(rustU8(value), 0, 2),
    vcaCharacter: (value) => clamp(value, 0, 0.02),
    jfetK3: (value) => clamp(value, 0, 0.5),
    xfmrK2: (value) => clamp(value, 0, 0.3),
    blendAmount: (value) => clamp(value, 0, 1),
} satisfies Record<NumericField, (value: number) => number>;

function topologyFromWire(value: number, fallback: GlutenTopology): GlutenTopology {
    return TOPOLOGIES[rustU8(value)] ?? fallback;
}

function withField<Key extends keyof GlutenPatch>(patch: GlutenPatch, key: Key, value: GlutenPatch[Key]): GlutenPatch {
    if (Object.is(patch[key], value)) {
        return patch;
    }
    return { ...patch, [key]: value };
}

function hydrateEncodedField<Key extends keyof GlutenPatch>(
    patch: GlutenPatch,
    encoded: Readonly<Record<string, unknown>>,
    key: Key,
    decode: (value: number) => GlutenPatch[Key]
): GlutenPatch {
    const stored = encoded[key];
    if (typeof stored !== 'number' || !Number.isFinite(stored)) {
        return patch;
    }
    return withField(patch, key, decode(stored));
}

export function hydrateGlutenPatchFromProject(deviceId: string, committedName?: string): void {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return;
    }

    const device = tracks.flatMap((track) => track.devices).find((candidate) => candidate.id === deviceId);
    if (device?.type !== 'gluten') {
        return;
    }

    const encoded = device.parameterValues;
    const currentPatch = getGlutenState(deviceId).patch;
    let patch = committedName === undefined ? currentPatch : { ...DEFAULT_PATCH, name: committedName };

    for (const field of NUMERIC_FIELDS) {
        patch = hydrateEncodedField(patch, encoded, field, NUMERIC_NORMALIZERS[field]);
    }

    for (const field of BOOLEAN_FIELDS) {
        patch = hydrateEncodedField(patch, encoded, field, (value) => value > 0.5);
    }

    patch = hydrateEncodedField(patch, encoded, GLUTEN_PARAM_IDS.topology, (value) =>
        topologyFromWire(value, DEFAULT_PATCH.topology)
    );
    patch = hydrateEncodedField(patch, encoded, GLUTEN_PARAM_IDS.blendTopology, (value) =>
        topologyFromWire(value, DEFAULT_PATCH.blendTopology)
    );
    patch = hydrateEncodedField(
        patch,
        encoded,
        GLUTEN_PARAM_IDS.style,
        (value) => STYLES[rustU8(value)] ?? DEFAULT_PATCH.style
    );
    patch = hydrateEncodedField(patch, encoded, GLUTEN_PARAM_IDS.detection, (value) => (value > 0.5 ? 'peak' : 'rms'));
    patch = hydrateEncodedField(
        patch,
        encoded,
        GLUTEN_PARAM_IDS.stereoMode,
        (value) => STEREO_MODES[rustU8(value)] ?? DEFAULT_PATCH.stereoMode
    );

    if (!valuesEqual(patch, currentPatch)) {
        loadGlutenPatch(deviceId, patch);
    }
}
