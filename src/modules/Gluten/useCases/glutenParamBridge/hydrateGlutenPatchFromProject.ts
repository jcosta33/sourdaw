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

function normalizeNumericField(field: (typeof NUMERIC_FIELDS)[number], value: number): number {
    switch (field) {
        case 'amount':
            return clamp(value, 0, 100);
        case 'threshold':
            return clamp(value, -60, 0);
        case 'ratio':
            return clamp(value, 1, 20);
        case 'attack':
            return clamp(value, 0.02, 250);
        case 'release':
            return clamp(value, 25, 5000);
        case 'knee':
            return clamp(value, 0, 30);
        case 'makeup':
            return clamp(value, -12, 24);
        case 'mix':
        case 'stereoLink':
        case 'blendAmount':
            return clamp(value, 0, 1);
        case 'range':
            return clamp(value, 0, 60);
        case 'scHpfFreq':
            return clamp(value, 20, 500);
        case 'thrust':
            return Math.min(2, rustU8(value));
        case 'oversampling':
            return clampOversampling(value);
        case 'lookahead':
            return clamp(value, 0, 20);
        case 'scLpfFreq':
            return clamp(value, 1000, 20000);
        case 'scEqFreq':
            return clamp(value, 20, 20000);
        case 'scEqGain':
            return clamp(value, -18, 18);
        case 'scEqQ':
            return clamp(value, 0.1, 10);
        case 'inputGain':
            return clamp(value, -12, 24);
        case 'outputGain':
            return clamp(value, -24, 24);
        case 'xfmrDrive':
            return clamp(value, 0, 3);
        case 'recovery':
            return clamp(rustU8(value), 1, 5);
        case 'vcaType':
            return clamp(rustU8(value), 0, 2);
        case 'vcaCharacter':
            return clamp(value, 0, 0.02);
        case 'jfetK3':
            return clamp(value, 0, 0.5);
        case 'xfmrK2':
            return clamp(value, 0, 0.3);
        default: {
            const exhaustiveField: never = field;
            return exhaustiveField;
        }
    }
}

function topologyFromWire(value: number, fallback: GlutenTopology): GlutenTopology {
    return TOPOLOGIES[rustU8(value)] ?? fallback;
}

function withField<Key extends keyof GlutenPatch>(patch: GlutenPatch, key: Key, value: GlutenPatch[Key]): GlutenPatch {
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

    let patch = { ...getGlutenState(deviceId).patch };

    for (const field of NUMERIC_FIELDS) {
        const stored = device.parameterValues[field];
        if (typeof stored === 'number' && Number.isFinite(stored)) {
            patch = withField(patch, field, normalizeNumericField(field, stored));
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

    loadGlutenPatch(deviceId, patch);
}
