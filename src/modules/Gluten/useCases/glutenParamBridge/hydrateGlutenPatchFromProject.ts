import { trackStore } from '#/modules/Arrangement/stores';

import { DEFAULT_PATCH, type GlutenPatch, type GlutenTopology } from '../../models/GlutenPatch';
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
            patch = withField(patch, field, stored);
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
