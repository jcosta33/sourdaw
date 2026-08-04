import { createDeviceAutomationTargetId } from '#/utils/automationDeviceTarget';

import { createMyceliumId } from './createMyceliumId';

import type { ProjectAutomationLane, ProjectAutomationPoint, ProjectTrack } from '../../../models/ProjectData';

type Profile =
    | 'drum'
    | 'bass'
    | 'voice'
    | 'atmosphere'
    | 'glitch'
    | 'return'
    | 'parallel-return'
    | 'master'
    | 'pan'
    | 'motion'
    | 'width';
type ParameterRange = readonly [min: number, max: number];
type DeviceLaneSpec = readonly [trackName: string, deviceType: string, parameterIds: readonly string[]];

const PAD_NAMES =
    'Kick|Snare|Closed HH|Open HH|Clap|Rim|Low Tom|Mid Tom|Hi Tom|Crash|Ride|Cowbell|Clave|Shaker|Perc 1|Perc 2'.split(
        '|'
    );

const GAIN_GROUPS: readonly [Profile, readonly string[]][] = [
    ['drum', PAD_NAMES],
    ['bass', ['Sub Mycelium', 'Rolling Colony', 'Acid Tendril']],
    [
        'voice',
        'Triplet Helix|Psy Pluck|Main Vision|Counter Vision|Harmonic Mist|FM Spores|Levain Call|Levain Answer|Grand Boule Ritual'.split(
            '|'
        ),
    ],
    ['atmosphere', ['Root Drone', 'Granular Voices', 'Fractal Riser', 'Impact Field']],
    ['glitch', ['Glitch Spirits']],
    ['return', ['Temple Chamber', 'Dub Tunnel', 'Mutation Return']],
    ['parallel-return', ['Parallel Crush']],
    ['master', ['Master']],
];

const PAN_TRACKS = [
    'Triplet Helix',
    'Psy Pluck',
    'Main Vision',
    'Counter Vision',
    'Harmonic Mist',
    'FM Spores',
    'Levain Call',
    'Levain Answer',
    'Grand Boule Ritual',
    'Granular Voices',
    'Fractal Riser',
    'Glitch Spirits',
] as const;

const DEVICE_LANES: readonly DeviceLaneSpec[] = [
    ['Pulse Engine', 'toaster', ['masterGain', 'swing', 'reverbMix', 'delayMix']],
    ['Sub Mycelium', 'fermenter', ['oscLevel', 'filterCutoff']],
    ['Rolling Colony', 'fermenter', ['filterCutoff', 'filterResonance']],
    ['Acid Tendril', 'fermenter', ['lfoRate', 'lfoFilterAmount']],
    ['Triplet Helix', 'fermenter', ['lfoRate', 'lfoPitchAmount']],
    ['Psy Pluck', 'fermenter', ['filterCutoff', 'filterEnvAmount']],
    ['Main Vision', 'fermenter', ['msegToFilter', 'unisonSpread']],
    ['Counter Vision', 'fermenter', ['lfoRate', 'lfoFilterAmount']],
    ['Harmonic Mist', 'fermenter', ['msegToFilter', 'filterCutoff']],
    ['FM Spores', 'fermenter', ['fmLevel2', 'fmFeedback']],
    ['Root Drone', 'fermenter', ['filterCutoff', 'noiseLevel']],
    ['Granular Voices', 'fermenter', ['grainDensity', 'grainSize', 'grainSpray']],
    ['Fractal Riser', 'fermenter', ['filterCutoff', 'filterResonance']],
    ['Impact Field', 'fermenter', ['noiseLevel', 'filterCutoff']],
    ['Glitch Spirits', 'fermenter', ['grainDensity', 'grainSpray']],
    ['Acid Tendril', 'builtin-filter', ['filter-cutoff', 'filter-resonance']],
    ['Acid Tendril', 'builtin-distortion', ['dist-mix']],
    ['Psy Pluck', 'builtin-delay', ['delay-feedback', 'delay-mix']],
    ['Main Vision', 'builtin-delay', ['delay-feedback', 'delay-mix']],
    ['Levain Answer', 'builtin-delay', ['delay-feedback', 'delay-mix']],
    ['Glitch Spirits', 'builtin-delay', ['delay-feedback', 'delay-mix']],
    ['Dub Tunnel', 'builtin-delay', ['delay-feedback']],
    ['Temple Chamber', 'dutch-oven', ['decay']],
    ['Counter Vision', 'builtin-autopan', ['autopan-rate', 'autopan-depth']],
    ['Granular Voices', 'builtin-autopan', ['autopan-rate', 'autopan-depth']],
    ['Triplet Helix', 'builtin-phaser', ['phaser-rate', 'phaser-depth']],
    ['Counter Vision', 'builtin-phaser', ['phaser-rate', 'phaser-depth']],
    ['Fractal Riser', 'builtin-phaser', ['phaser-rate', 'phaser-depth']],
    ['Main Vision', 'builtin-chorus', ['chorus-rate', 'chorus-depth']],
    ['Levain Answer', 'builtin-chorus', ['chorus-rate', 'chorus-depth']],
    ['Granular Voices', 'builtin-chorus', ['chorus-rate', 'chorus-depth']],
    ['Harmonic Mist', 'builtin-tremolo', ['trem-rate', 'trem-depth']],
    ['Master', 'builtin-stereo-widener', ['width-amount']],
];

const PARAMETER_RANGES: Readonly<Record<string, ParameterRange>> = {
    'toaster:masterGain': [0.78, 1.08],
    'toaster:swing': [0.02, 0.12],
    'toaster:reverbMix': [0.02, 0.14],
    'toaster:delayMix': [0, 0.08],
    'fermenter:oscLevel': [0, 1],
    'fermenter:filterCutoff': [100, 12_000],
    'fermenter:filterResonance': [0.5, 10],
    'fermenter:lfoRate': [0.1, 12],
    'fermenter:lfoFilterAmount': [-1, 1],
    'fermenter:lfoPitchAmount': [-1, 1],
    'fermenter:filterEnvAmount': [-1, 1],
    'fermenter:msegToFilter': [-1, 1],
    'fermenter:unisonSpread': [0, 1],
    'fermenter:fmLevel2': [0, 1],
    'fermenter:fmFeedback': [0, 0.65],
    'fermenter:noiseLevel': [0, 1],
    'fermenter:grainDensity': [5, 80],
    'fermenter:grainSize': [10, 250],
    'fermenter:grainSpray': [0, 1],
    'builtin-filter:filter-cutoff': [100, 12_000],
    'builtin-filter:filter-resonance': [0.5, 10],
    'builtin-distortion:dist-mix': [0.1, 0.75],
    'builtin-delay:delay-feedback': [0.15, 0.75],
    'builtin-delay:delay-mix': [0.05, 0.55],
    'dutch-oven:decay': [0.35, 0.95],
    'builtin-autopan:autopan-rate': [0.1, 4],
    'builtin-autopan:autopan-depth': [0.1, 0.9],
    'builtin-phaser:phaser-rate': [0.1, 2],
    'builtin-phaser:phaser-depth': [0.2, 0.9],
    'builtin-chorus:chorus-rate': [0.1, 2],
    'builtin-chorus:chorus-depth': [1, 12],
    'builtin-tremolo:trem-rate': [0.5, 12],
    'builtin-tremolo:trem-depth': [0.1, 0.85],
    'builtin-stereo-widener:width-amount': [0.65, 1.25],
};

const PROFILES: Readonly<Record<Profile, readonly (readonly [number, number])[]>> = {
    drum: [
        [0, 0],
        [64, 0.12],
        [128, 0.78],
        [191.5, 1],
        [191.75, 0],
        [192, 1],
        [288, 0],
        [352, 0.24],
        [415.5, 1],
        [415.75, 0],
        [416, 1],
        [479.75, 1],
        [480, 0],
        [483.75, 0],
        [484, 1],
        [544, 0.38],
        [560, 0],
        [568, 0],
        [576, 0],
    ],
    bass: [
        [0, 0],
        [64, 0.08],
        [128, 0.52],
        [191.5, 0.92],
        [191.75, 0],
        [192, 0.92],
        [288, 0],
        [316, 0],
        [352, 0.18],
        [415.5, 0.96],
        [415.75, 0],
        [416, 0.96],
        [479.75, 0.96],
        [480, 0],
        [483.75, 0],
        [484, 0.96],
        [544, 0.32],
        [560, 0.24],
        [568, 0.16],
        [576, 0],
    ],
    voice: [
        [0, 0.04],
        [64, 0.18],
        [128, 0.52],
        [191.5, 0.82],
        [191.75, 0],
        [192, 0.82],
        [288, 0.16],
        [352, 0.42],
        [415.5, 0.9],
        [415.75, 0],
        [416, 0.9],
        [479.75, 0.9],
        [480, 0],
        [483.75, 0],
        [484, 0.88],
        [544, 0.48],
        [568, 0],
        [576, 0],
    ],
    atmosphere: [
        [0, 0.5],
        [64, 0.44],
        [128, 0.38],
        [192, 0.32],
        [288, 0.76],
        [352, 0.58],
        [416, 0.38],
        [480, 0.24],
        [484, 0.42],
        [544, 0.68],
        [568, 0.28],
        [576, 0],
    ],
    glitch: [
        [0, 0.5],
        [64, 0.44],
        [128, 0.38],
        [192, 0.32],
        [288, 0.76],
        [352, 0.58],
        [416, 0.38],
        [479.75, 0.38],
        [480, 0],
        [483.75, 0],
        [484, 0.42],
        [544, 0.68],
        [568, 0.28],
        [576, 0],
    ],
    return: [
        [0, 0.08],
        [64, 0.18],
        [128, 0.32],
        [188, 0.62],
        [192, 0.18],
        [223.75, 0.18],
        [224, 0.62],
        [255.75, 0.62],
        [256, 0.18],
        [287.75, 0.18],
        [288, 0.54],
        [352, 0.28],
        [412, 0.72],
        [416, 0.2],
        [480, 0.08],
        [484, 0.7],
        [544, 0.78],
        [568, 0.22],
        [576, 0],
    ],
    'parallel-return': [
        [0, 0],
        [64, 0.02],
        [128, 0.04],
        [188, 0.1],
        [192, 0.05],
        [223.75, 0.05],
        [224, 0.12],
        [255.75, 0.12],
        [256, 0.06],
        [287.75, 0.06],
        [288, 0.03],
        [352, 0.03],
        [412, 0.12],
        [416, 0.05],
        [480, 0],
        [484, 0.14],
        [544, 0.07],
        [568, 0.03],
        [576, 0],
    ],
    master: [
        [0, 0.82],
        [128, 0.83],
        [191.75, 0.8],
        [192, 0.84],
        [415.75, 0.8],
        [416, 0.85],
        [480, 0.8],
        [484, 0.84],
        [544, 0.82],
        [576, 0.78],
    ],
    pan: [
        [0, 0.4],
        [64, 0.62],
        [128, 0.28],
        [192, 0.7],
        [288, 0.35],
        [352, 0.66],
        [416, 0.24],
        [480, 0.58],
        [484, 0.32],
        [544, 0.64],
        [576, 0.5],
    ],
    motion: [
        [0, 0.22],
        [64, 0.34],
        [128, 0.52],
        [188, 0.76],
        [192, 0.38],
        [288, 0.62],
        [352, 0.46],
        [412, 0.84],
        [416, 0.42],
        [480, 0.18],
        [484, 0.72],
        [544, 0.58],
        [576, 0.24],
    ],
    width: [
        [0, 0.34],
        [128, 0.4],
        [188, 0.3],
        [191.75, 0.12],
        [192, 0.44],
        [352, 0.36],
        [412, 0.24],
        [415.75, 0.1],
        [416, 0.46],
        [480, 0.2],
        [484, 0.42],
        [544, 0.3],
        [576, 0.26],
    ],
};

function title(parameterId: string): string {
    return parameterId.replaceAll('-', ' ').replaceAll(/([a-z])([A-Z])/g, '$1 $2');
}

function createPoints(profile: Profile, min: number, max: number, invert = false): ProjectAutomationPoint[] {
    return PROFILES[profile].map(([beat, normalized]) => ({
        beat,
        value: min + (max - min) * (invert ? 1 - normalized : normalized),
        curve: [191.75, 223.75, 224, 255.75, 256, 415.75, 480, 483.75].includes(beat) ? 'step' : 'linear',
        tension: 0,
    }));
}

function createLane(
    track: ProjectTrack,
    parameterId: string,
    min: number,
    max: number,
    profile: Profile,
    invert = false
): ProjectAutomationLane {
    return {
        id: createMyceliumId('automation', `${track.name}:${parameterId}`),
        trackId: track.id,
        parameterId,
        parameterName: title(parameterId.slice(parameterId.indexOf(':') + 1)),
        points: createPoints(profile, min, max, invert),
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: min,
        maxValue: max,
        color: track.color,
    };
}

export function createMyceliumAutomation(sourceTracks: readonly ProjectTrack[]) {
    const tracks = sourceTracks.map((track) => ({
        ...track,
        devices: track.devices.map((device) => ({ ...device, parameterValues: { ...device.parameterValues } })),
    }));
    const trackByName = new Map(tracks.map((track) => [track.name, track]));
    function requireTrack(name: string): ProjectTrack {
        const track = trackByName.get(name);
        if (!track || tracks.filter((candidate) => candidate.name === name).length !== 1) {
            throw new Error(`Expected one Mycelium track named ${name}`);
        }
        return track;
    }
    const lanes: ProjectAutomationLane[] = [];
    for (const [profile, names] of GAIN_GROUPS) {
        for (const name of names) {
            lanes.push(createLane(requireTrack(name), 'gain', 0, 1, profile));
        }
    }
    for (const [index, name] of PAN_TRACKS.entries()) {
        lanes.push(createLane(requireTrack(name), 'pan', -1, 1, 'pan', index % 2 === 1));
    }
    for (const [trackName, deviceType, parameterIds] of DEVICE_LANES) {
        const track = requireTrack(trackName);
        const devices = track.devices.filter((device) => device.type === deviceType);
        if (devices.length !== 1) {
            throw new Error(`Expected one ${deviceType} device on ${trackName}`);
        }
        const device = devices[0]!;
        for (const parameterId of parameterIds) {
            const range = PARAMETER_RANGES[`${deviceType}:${parameterId}`];
            if (!range) {
                throw new Error(`Missing automation range for ${deviceType}:${parameterId}`);
            }
            const targetId = createDeviceAutomationTargetId(device.id, parameterId);
            const profile: Profile = parameterId === 'width-amount' ? 'width' : 'motion';
            const lane = createLane(track, targetId, range[0], range[1], profile);
            device.parameterValues[parameterId] = lane.points[0]!.value;
            lanes.push(lane);
        }
    }
    const keys = new Set(lanes.map((lane) => `${lane.trackId}:${lane.parameterId}`));
    if (keys.size !== lanes.length) {
        throw new Error('Mycelium automation contains duplicate track/parameter lanes');
    }
    return { tracks, lanes };
}
