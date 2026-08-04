import { getToasterPresetDeviceState } from '#/modules/Toaster/useCases';

import { createMyceliumId } from './createMyceliumId';

import type { ProjectDevice, ProjectSidechainRoute, ProjectTrack, ProjectTrackKind } from '../../../models/ProjectData';

type TrackSpec = readonly [
    name: string,
    kind: ProjectTrackKind,
    parentName: string | null,
    deviceTypes: readonly string[],
    sendNames?: readonly string[],
];

const PAD_NAMES = [
    'Kick',
    'Snare',
    'Closed HH',
    'Open HH',
    'Clap',
    'Rim',
    'Low Tom',
    'Mid Tom',
    'Hi Tom',
    'Crash',
    'Ride',
    'Cowbell',
    'Clave',
    'Shaker',
    'Perc 1',
    'Perc 2',
] as const;

const PARALLEL_CRUSH_SEND_LEVELS: Readonly<Record<string, number>> = {
    Snare: 0.1,
    Clap: 0.08,
    Rim: 0.06,
    'Low Tom': 0.08,
    'Mid Tom': 0.08,
    'Hi Tom': 0.08,
    'Perc 1': 0.05,
    'Perc 2': 0.05,
};

const TRACK_SPECS: readonly TrackSpec[] = [
    ['Master', 'master', null, ['builtin-eq', 'gluten', 'builtin-stereo-widener', 'proof', 'builtin-lufs-meter']],
    ['Pulse Engine', 'folder', null, ['toaster']],
    ...PAD_NAMES.map((name): TrackSpec => [
        name,
        'midi',
        'Pulse Engine',
        [],
        PARALLEL_CRUSH_SEND_LEVELS[name] === undefined ? [] : ['Parallel Crush'],
    ]),
    ['Bass Mutation', 'folder', null, []],
    ['Sub Mycelium', 'midi', 'Bass Mutation', ['fermenter', 'builtin-eq']],
    ['Rolling Colony', 'midi', 'Bass Mutation', ['fermenter', 'builtin-eq', 'builtin-sidechain-compressor']],
    [
        'Acid Tendril',
        'midi',
        'Bass Mutation',
        ['fermenter', 'builtin-filter', 'builtin-distortion', 'bacteria'],
        ['Mutation Return'],
    ],
    ['Fractal Synthesis', 'folder', null, []],
    ['Triplet Helix', 'midi', 'Fractal Synthesis', ['yeast', 'fermenter', 'builtin-phaser']],
    ['Psy Pluck', 'midi', 'Fractal Synthesis', ['fermenter', 'builtin-delay'], ['Temple Chamber', 'Dub Tunnel']],
    [
        'Main Vision',
        'midi',
        'Fractal Synthesis',
        ['fermenter', 'builtin-chorus', 'builtin-delay'],
        ['Temple Chamber', 'Dub Tunnel'],
    ],
    [
        'Counter Vision',
        'midi',
        'Fractal Synthesis',
        ['fermenter', 'builtin-phaser', 'builtin-autopan'],
        ['Temple Chamber'],
    ],
    [
        'Harmonic Mist',
        'midi',
        'Fractal Synthesis',
        ['fermenter', 'builtin-tremolo', 'builtin-reverb'],
        ['Temple Chamber'],
    ],
    ['FM Spores', 'midi', 'Fractal Synthesis', ['fermenter', 'builtin-bitcrusher', 'builtin-distortion']],
    ['Organic Signals', 'folder', null, []],
    ['Levain Call', 'midi', 'Organic Signals', ['levain', 'builtin-reverb'], ['Temple Chamber', 'Dub Tunnel']],
    [
        'Levain Answer',
        'midi',
        'Organic Signals',
        ['levain', 'builtin-chorus', 'builtin-delay'],
        ['Temple Chamber', 'Dub Tunnel'],
    ],
    ['Grand Boule Ritual', 'midi', 'Organic Signals', ['grand-boule', 'builtin-reverb'], ['Temple Chamber']],
    ['Atmospheres & FX', 'folder', null, []],
    ['Root Drone', 'midi', 'Atmospheres & FX', ['fermenter', 'builtin-filter'], ['Temple Chamber']],
    [
        'Granular Voices',
        'midi',
        'Atmospheres & FX',
        ['fermenter', 'builtin-autopan', 'builtin-chorus'],
        ['Temple Chamber', 'Dub Tunnel'],
    ],
    ['Fractal Riser', 'midi', 'Atmospheres & FX', ['fermenter', 'builtin-filter', 'builtin-phaser']],
    ['Impact Field', 'midi', 'Atmospheres & FX', ['fermenter', 'builtin-reverb'], ['Temple Chamber']],
    [
        'Glitch Spirits',
        'midi',
        'Atmospheres & FX',
        ['fermenter', 'builtin-bitcrusher', 'builtin-delay'],
        ['Mutation Return'],
    ],
    ['Temple Chamber', 'bus', null, ['dutch-oven']],
    ['Dub Tunnel', 'bus', null, ['builtin-delay']],
    ['Mutation Return', 'bus', null, ['bacteria', 'builtin-filter', 'builtin-bitcrusher']],
    ['Parallel Crush', 'bus', null, ['builtin-compressor', 'builtin-distortion']],
];

const FERMENTER_AUTOMATION_DEFAULTS: Readonly<Record<string, number>> = {
    oscEngine: 0,
    oscLevel: 0.8,
    filterCutoff: 5_000,
    filterResonance: 1,
    lfoRate: 0,
    lfoFilterAmount: 0,
    lfoPitchAmount: 0,
    filterEnvAmount: 0.5,
    msegToFilter: 0,
    unisonSpread: 0.7,
    fmLevel2: 0.8,
    fmFeedback: 0,
    noiseLevel: 0,
    grainDensity: 20,
    grainSize: 50,
    grainSpray: 0.1,
};

const FERMENTER_ROLE_OVERRIDES: Readonly<Record<string, Record<string, number>>> = {
    'Sub Mycelium': { oscEngine: 1, oscLevel: 0.95, filterCutoff: 700 },
    'Rolling Colony': { oscEngine: 1, filterCutoff: 1_600, filterResonance: 2.2 },
    'Acid Tendril': { oscEngine: 2, filterModel: 5, lfoRate: 2.8, lfoFilterAmount: 0.7 },
    'Triplet Helix': { lfoRate: 6, lfoPitchAmount: 0.12 },
    'Psy Pluck': { filterCutoff: 4_200, filterEnvAmount: 0.8 },
    'Main Vision': { oscEngine: 5, msegToFilter: 0.55, unisonSpread: 0.9 },
    'Counter Vision': { lfoRate: 1.5, lfoFilterAmount: -0.4 },
    'Harmonic Mist': { oscEngine: 5, msegToFilter: 0.3, filterCutoff: 7_500 },
    'FM Spores': { oscEngine: 2, fmLevel2: 0.95, fmFeedback: 0.35 },
    'Root Drone': { oscEngine: 1, filterCutoff: 800, noiseLevel: 0.12 },
    'Granular Voices': { oscEngine: 4, grainDensity: 36, grainSize: 110, grainSpray: 0.45 },
    'Fractal Riser': { oscEngine: 5, filterModel: 5, filterCutoff: 900, filterResonance: 3.5 },
    'Impact Field': { oscEngine: 1, noiseLevel: 0.65, filterCutoff: 2_400 },
    'Glitch Spirits': { oscEngine: 4, grainDensity: 72, grainSize: 24, grainSpray: 0.85 },
};

function createDeviceParams(type: string, kind: ProjectTrackKind, trackName: string): Record<string, number> {
    if (type === 'builtin-eq') {
        return { 'eq-low-freq': 90, 'eq-low-gain': 0, 'eq-high-freq': 10_000, 'eq-high-gain': 0 };
    }
    if (type === 'builtin-stereo-widener') {
        return { 'width-amount': 1, 'width-mono-bass': 150 };
    }
    if (type === 'proof') {
        return { lim_ceiling: -0.8 };
    }
    if (type === 'builtin-lufs-meter') {
        return { 'lufs-target': -9.5 };
    }
    if (type === 'toaster') {
        return { masterGain: 0.9, swing: 0.04, reverbMix: 0.08, delayMix: 0.02 };
    }
    if (type === 'fermenter') {
        return { ...FERMENTER_AUTOMATION_DEFAULTS, ...FERMENTER_ROLE_OVERRIDES[trackName] };
    }
    if (type === 'builtin-filter') {
        return { 'filter-cutoff': 1_000, 'filter-resonance': 1 };
    }
    if (type === 'builtin-autopan') {
        return { 'autopan-rate': 2, 'autopan-depth': 0.7 };
    }
    if (type === 'builtin-phaser') {
        return { 'phaser-rate': 0.5, 'phaser-depth': 0.7 };
    }
    if (type === 'builtin-chorus') {
        return { 'chorus-rate': 1.5, 'chorus-depth': 5 };
    }
    if (type === 'builtin-tremolo') {
        return { 'trem-rate': 4, 'trem-depth': 0.5 };
    }
    if (type === 'builtin-distortion' && kind !== 'bus') {
        return { 'dist-mix': 0.5 };
    }
    if (type === 'builtin-delay' && kind !== 'bus') {
        return { 'delay-mix': 0.3, 'delay-feedback': 0.4 };
    }
    if (type === 'bacteria' && trackName === 'Acid Tendril') {
        return {
            mix: 0.45,
            inputGain: 0,
            outputGain: 0,
            bypass: 0,
            bandCount: 1,
            band0_enabled: 1,
            band0_oversampling: 2,
            band0_distortionEnabled: 1,
            band0_distortionMode: 5,
            band0_drive: 28,
            band0_asymmetry: 0.15,
            band0_filterEnabled: 1,
            band0_filterMode: 0,
            band0_filterCutoff: 6_200,
            band0_filterResonance: 0.35,
            band0_freqShiftEnabled: 1,
            band0_freqShiftHz: 14,
            band0_freqShiftMix: 0.18,
        };
    }
    if (type === 'bacteria' && trackName === 'Mutation Return') {
        return {
            mix: 1,
            inputGain: -2,
            outputGain: -1,
            bypass: 0,
            bandCount: 1,
            band0_enabled: 1,
            band0_oversampling: 2,
            band0_distortionEnabled: 1,
            band0_distortionMode: 3,
            band0_drive: 40,
            band0_lofiEnabled: 1,
            band0_lofiAmount: 35,
            band0_codecArtifact: 0.22,
        };
    }
    if (type === 'builtin-compressor' && trackName === 'Parallel Crush') {
        return {
            'comp-threshold': -26,
            'comp-ratio': 6,
            'comp-attack': 12,
            'comp-release': 90,
            'comp-knee': 9,
            'comp-makeup': 3,
        };
    }
    if (type === 'builtin-distortion' && trackName === 'Parallel Crush') {
        return { 'dist-drive': 2.5, 'dist-tone': 6_500, 'dist-output': -8, 'dist-mix': 1 };
    }
    if (kind !== 'bus') {
        return {};
    }
    if (type === 'dutch-oven') {
        return { mix: 1, decay: 0.75 };
    }
    if (type === 'builtin-delay') {
        return { 'delay-mix': 1, 'delay-feedback': 0.55 };
    }
    if (type === 'builtin-bitcrusher') {
        return { 'crush-mix': 1 };
    }
    if (type === 'builtin-distortion') {
        return { 'dist-mix': 1 };
    }
    return {};
}

function createDeviceState(type: string): ProjectDevice['deviceState'] {
    if (type !== 'toaster') {
        return undefined;
    }

    const state = getToasterPresetDeviceState('psytrance-mycelium');
    if (!state) {
        throw new Error('Missing Mycelium Toaster kit');
    }
    return state;
}

function createSendLevel(trackName: string, busName: string): number {
    if (busName === 'Parallel Crush') {
        const level = PARALLEL_CRUSH_SEND_LEVELS[trackName];
        if (level === undefined) {
            throw new Error(`Missing Parallel Crush send level for ${trackName}`);
        }
        return level;
    }
    return 0.25;
}

function requireId(ids: ReadonlyMap<string, string>, name: string): string {
    const id = ids.get(name);
    if (!id) {
        throw new Error(`Unknown Mycelium track: ${name}`);
    }
    return id;
}

function resolveOutputId({
    ids,
    kind,
    masterId,
    parentName,
}: {
    ids: ReadonlyMap<string, string>;
    kind: ProjectTrackKind;
    masterId: string;
    parentName: string | null;
}): string {
    if (kind === 'master') {
        return 'hw_out';
    }
    if (parentName === 'Pulse Engine') {
        return requireId(ids, parentName);
    }
    return masterId;
}

export function createMyceliumTopology(): { tracks: ProjectTrack[]; sidechainRoutes: ProjectSidechainRoute[] } {
    const ids = new Map(TRACK_SPECS.map(([name]) => [name, createMyceliumId('track', name)]));
    const masterId = requireId(ids, 'Master');
    const tracks = TRACK_SPECS.map(
        ([name, kind, parentName, deviceTypes, sendNames = []], trackIndex): ProjectTrack => {
            const id = requireId(ids, name);
            const alternativeId = createMyceliumId('alternative', name);
            const devices: ProjectDevice[] = deviceTypes.map((type, deviceIndex) => {
                const deviceState = createDeviceState(type);
                return {
                    id: createMyceliumId('device', `${name}:${deviceIndex}:${type}`),
                    name: type.replace('builtin-', '').replaceAll('-', ' '),
                    type,
                    bypassed: false,
                    parameterValues: createDeviceParams(type, kind, name),
                    ...(deviceState ? { deviceState } : {}),
                };
            });
            return {
                id,
                name,
                kind,
                muted: false,
                soloed: false,
                armed: false,
                gain: 1,
                pan: 0,
                color: `oklch(0.42 0.07 ${220 + ((trackIndex * 17) % 140)})`,
                clips: [],
                devices,
                sends: sendNames.map((busName) => ({
                    busId: requireId(ids, busName),
                    level: createSendLevel(name, busName),
                    preFader: false,
                })),
                midiFx: [],
                frozen: false,
                freezeState: { status: 'unfrozen' },
                parentId: parentName ? requireId(ids, parentName) : null,
                collapsed: false,
                inputMonitoring: 'auto',
                hidden: false,
                disabled: false,
                height: 64,
                outputId: resolveOutputId({ ids, kind, masterId, parentName }),
                automationMode: 'read',
                groupId: null,
                soloSafe: kind === 'bus',
                notes: parentName === 'Pulse Engine' ? `Toaster pad ${trackIndex - 2}; GM note ${34 + trackIndex}` : '',
                inputId: null,
                activeAlternativeId: alternativeId,
                alternatives: [{ id: alternativeId, name: 'Main', clips: [] }],
                vcaGroupId: null,
                midiOutputTrackId: null,
                followChordTrack: kind === 'midi' && parentName !== 'Pulse Engine',
            };
        }
    );
    const kick = tracks.find((track) => track.name === 'Kick');
    const rolling = tracks.find((track) => track.name === 'Rolling Colony');
    const compressor = rolling?.devices.find((device) => device.type === 'builtin-sidechain-compressor');
    if (!kick || !rolling || !compressor) {
        throw new Error('Mycelium sidechain endpoints are incomplete');
    }
    return {
        tracks,
        sidechainRoutes: [
            {
                id: createMyceliumId('sidechain', 'kick-to-rolling-colony'),
                sourceTrackId: kick.id,
                targetTrackId: rolling.id,
                targetDeviceId: compressor.id,
                targetParameterId: 'sc-comp-threshold',
                gain: 1,
            },
        ],
    };
}
