import { trackStore } from '#/modules/Arrangement/stores';

import { clampOversampling, DEFAULT_PATCH, type GlutenPatch, type GlutenTopology } from '../../models/GlutenPatch';
import { getGlutenState, loadGlutenPatch } from '../../stores/glutenStore';

const TOPOLOGIES = ['vca', 'opto', 'fet', 'diode'] as const;
const STYLES = ['glue', 'punch', 'smooth', 'pump'] as const;
const STEREO_MODES = ['stereo', 'mid', 'side', 'dual-mono'] as const;

const NUMERIC_FIELDS = [
    'amount',
    'threshold',
    'ratio',
    'attack',
    'release',
    'knee',
    'makeup',
    'mix',
    'range',
    'scHpfFreq',
    'thrust',
    'stereoLink',
    'oversampling',
    'lookahead',
    'scLpfFreq',
    'scEqFreq',
    'scEqGain',
    'scEqQ',
    'inputGain',
    'outputGain',
    'xfmrDrive',
    'recovery',
    'vcaType',
    'vcaCharacter',
    'jfetK3',
    'xfmrK2',
    'blendAmount',
] as const satisfies readonly (keyof GlutenPatch)[];

const BOOLEAN_FIELDS = [
    'autoMakeup',
    'autoRelease',
    'scHpfEnabled',
    'scLpfEnabled',
    'scEqEnabled',
    'deltaListen',
    'gainMatchBypass',
    'extSidechain',
    'allButtons',
    'limitMode',
    'feedForward',
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
    scLpfFreq: (value) => clamp(value, 1000, 20000),
    scEqFreq: (value) => clamp(value, 20, 20000),
    scEqGain: (value) => clamp(value, -18, 18),
    scEqQ: (value) => clamp(value, 0.1, 10),
    inputGain: (value) => clamp(value, -12, 24),
    outputGain: (value) => clamp(value, -24, 24),
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

export function hydrateGlutenPatchFromProject(deviceId: string): void {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return;
    }

    const device = tracks.flatMap((track) => track.devices).find((candidate) => candidate.id === deviceId);
    if (!device) {
        return;
    }

    const currentPatch = getGlutenState(deviceId).patch;
    let patch = currentPatch;

    for (const field of NUMERIC_FIELDS) {
        const stored = device.parameterValues[field];
        if (typeof stored === 'number' && Number.isFinite(stored)) {
            patch = withField(patch, field, NUMERIC_NORMALIZERS[field](stored));
        }
    }

    for (const field of BOOLEAN_FIELDS) {
        const stored = device.parameterValues[field];
        if (typeof stored === 'number' && Number.isFinite(stored)) {
            patch = withField(patch, field, stored > 0.5);
        }
    }

    const topology = device.parameterValues.topology;
    if (typeof topology === 'number' && Number.isFinite(topology)) {
        patch = withField(patch, 'topology', topologyFromWire(topology, DEFAULT_PATCH.topology));
    }

    const blendTopology = device.parameterValues.blendTopology;
    if (typeof blendTopology === 'number' && Number.isFinite(blendTopology)) {
        patch = withField(patch, 'blendTopology', topologyFromWire(blendTopology, DEFAULT_PATCH.blendTopology));
    }

    const style = device.parameterValues.style;
    if (typeof style === 'number' && Number.isFinite(style)) {
        patch = withField(patch, 'style', STYLES[rustU8(style)] ?? DEFAULT_PATCH.style);
    }

    const detection = device.parameterValues.detection;
    if (typeof detection === 'number' && Number.isFinite(detection)) {
        patch = withField(patch, 'detection', detection > 0.5 ? 'peak' : 'rms');
    }

    const stereoMode = device.parameterValues.stereoMode;
    if (typeof stereoMode === 'number' && Number.isFinite(stereoMode)) {
        patch = withField(patch, 'stereoMode', STEREO_MODES[rustU8(stereoMode)] ?? DEFAULT_PATCH.stereoMode);
    }

    if (patch !== currentPatch) {
        loadGlutenPatch(deviceId, patch);
    }
}
