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

const TRACK_SPECS: readonly TrackSpec[] = [
    ['Master', 'master', null, ['builtin-eq', 'gluten', 'builtin-stereo-widener', 'proof', 'builtin-lufs-meter']],
    ['Pulse Engine', 'folder', null, ['toaster']],
    ...PAD_NAMES.map((name): TrackSpec => [name, 'midi', 'Pulse Engine', [], ['Parallel Crush']]),
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
    ['Temple Chamber', 'bus', null, ['proof-chamber']],
    ['Dub Tunnel', 'bus', null, ['builtin-delay']],
    ['Mutation Return', 'bus', null, ['bacteria', 'builtin-filter', 'builtin-bitcrusher']],
    ['Parallel Crush', 'bus', null, ['builtin-compressor', 'builtin-distortion']],
];

function createDeviceParams(type: string, kind: ProjectTrackKind): Record<string, number> {
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
        return { masterGain: 1, swing: 0.08, reverbMix: 0.12, delayMix: 0.04 };
    }
    if (kind !== 'bus') {
        return {};
    }
    if (type === 'proof-chamber') {
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
        return '';
    }
    if (parentName) {
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
            const devices: ProjectDevice[] = deviceTypes.map((type, deviceIndex) => ({
                id: createMyceliumId('device', `${name}:${deviceIndex}:${type}`),
                name: type.replace('builtin-', '').replaceAll('-', ' '),
                type,
                bypassed: false,
                parameterValues: createDeviceParams(type, kind),
            }));
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
                sends: sendNames.map((busName) => ({ busId: requireId(ids, busName), level: 0.25, preFader: false })),
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
