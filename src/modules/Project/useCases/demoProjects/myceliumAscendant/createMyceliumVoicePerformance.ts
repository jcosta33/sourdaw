import { createMyceliumId } from './createMyceliumId';

import type { ProjectClip, ProjectData, ProjectMidiNote, ProjectTrack } from '../../../models/ProjectData';

type VoiceSpec = readonly [name: string, basePitch: number, family: 'synth' | 'organic' | 'atmosphere'];
type NoteSeed = { beat: number; duration: number; velocity: number; pitch: number };
type Section = { key: keyof typeof ACTIVE_TRACKS; name: string; startBeat: number; endBeat: number };

const CELL = [0, 3, 7, 2] as const;
const SECTION_TRANSPOSITIONS = [0, 5, -2, 7, 3, -5, 12, 0] as const;
const SECTIONS: readonly Section[] = [
    { key: 'sporefall', name: 'Sporefall', startBeat: 0, endBeat: 64 },
    { key: 'germination', name: 'First Germination', startBeat: 64, endBeat: 128 },
    { key: 'pressure', name: 'Pressure Bloom', startBeat: 128, endBeat: 192 },
    { key: 'drop-one', name: 'Drop I', startBeat: 192, endBeat: 288 },
    { key: 'chapel', name: 'Psilocybin Chapel', startBeat: 288, endBeat: 352 },
    { key: 'build', name: 'Singularity Build', startBeat: 352, endBeat: 416 },
    { key: 'drop-two', name: 'Drop II', startBeat: 416, endBeat: 544 },
    { key: 'dissolution', name: 'Dissolution', startBeat: 544, endBeat: 576 },
];

const VOICES: readonly VoiceSpec[] = [
    ['Triplet Helix', 69, 'synth'],
    ['Psy Pluck', 64, 'synth'],
    ['Main Vision', 72, 'synth'],
    ['Counter Vision', 67, 'synth'],
    ['Harmonic Mist', 60, 'synth'],
    ['FM Spores', 72, 'synth'],
    ['Levain Call', 76, 'organic'],
    ['Levain Answer', 69, 'organic'],
    ['Grand Boule Ritual', 55, 'organic'],
    ['Root Drone', 33, 'atmosphere'],
    ['Granular Voices', 60, 'atmosphere'],
    ['Fractal Riser', 48, 'atmosphere'],
    ['Impact Field', 36, 'atmosphere'],
    ['Glitch Spirits', 72, 'atmosphere'],
];

const ACTIVE_TRACKS = {
    sporefall: [
        'Harmonic Mist',
        'Levain Call',
        'Grand Boule Ritual',
        'Root Drone',
        'Granular Voices',
        'Glitch Spirits',
    ],
    germination: ['Triplet Helix', 'Psy Pluck', 'Levain Answer', 'Granular Voices'],
    pressure: ['Psy Pluck', 'FM Spores', 'Granular Voices', 'Fractal Riser', 'Impact Field'],
    'drop-one': [
        'Psy Pluck',
        'Main Vision',
        'Counter Vision',
        'FM Spores',
        'Levain Call',
        'Levain Answer',
        'Grand Boule Ritual',
        'Glitch Spirits',
    ],
    chapel: [
        'Psy Pluck',
        'Harmonic Mist',
        'Levain Call',
        'Levain Answer',
        'Grand Boule Ritual',
        'Root Drone',
        'Granular Voices',
        'Glitch Spirits',
    ],
    build: ['Triplet Helix', 'FM Spores', 'Fractal Riser', 'Impact Field', 'Glitch Spirits'],
    'drop-two': [
        'Triplet Helix',
        'Psy Pluck',
        'Main Vision',
        'Counter Vision',
        'Harmonic Mist',
        'FM Spores',
        'Levain Call',
        'Levain Answer',
        'Grand Boule Ritual',
        'Glitch Spirits',
    ],
    dissolution: ['Main Vision', 'Harmonic Mist', 'Levain Call', 'Grand Boule Ritual', 'Root Drone', 'Granular Voices'],
};

function getWindows(section: Section, trackName: string): readonly (readonly [number, number])[] {
    if (section.key === 'drop-two') {
        return [[416, 544]];
    }
    if (section.key === 'chapel') {
        return [
            [288, 316],
            [316, 352],
        ];
    }
    if (section.key === 'pressure') {
        return [[128, 191.75]];
    }
    if (section.key === 'build') {
        return [[352, 415.75]];
    }
    if (section.key === 'dissolution') {
        if (trackName === 'Main Vision') {
            return [[544, 552]];
        }
        if (trackName === 'Harmonic Mist') {
            return [[544, 560]];
        }
    }
    return [[section.startBeat, section.endBeat]];
}

type PitchForInput = { spec: VoiceSpec; trackIndex: number; sectionIndex: number; cellIndex: number };

function pitchFor({ spec, trackIndex, sectionIndex, cellIndex }: PitchForInput): number {
    const [, basePitch] = spec;
    const interval = CELL[cellIndex % CELL.length]!;
    const inverted = (trackIndex + sectionIndex) % 2 === 1;
    const register = ((trackIndex % 3) - 1) * 12;
    const dropLift = sectionIndex === 6 && trackIndex < 6 ? 12 : 0;
    const transformedInterval = inverted ? -interval : interval;
    return basePitch + register + dropLift + SECTION_TRANSPOSITIONS[sectionIndex]! + transformedInterval;
}

function genericSeeds(spec: VoiceSpec, section: Section, trackIndex: number, sectionIndex: number): NoteSeed[] {
    const [name, , family] = spec;
    const seeds: NoteSeed[] = [];
    const exchangeLeadIndex = ['Main Vision', 'Counter Vision'].indexOf(name);
    const displacement = [0.125, 0.375, 0.625, 0.875][(trackIndex + sectionIndex) % 4]!;
    for (const [windowStart, windowEnd] of getWindows(section, name)) {
        let phraseLength = family === 'atmosphere' ? 16 : 8;
        if (section.key === 'chapel') {
            phraseLength = windowStart < 316 ? 3.5 : 4;
        }
        if (section.key === 'build') {
            phraseLength = family === 'atmosphere' ? 8 : 4;
        }
        let spacing = 1;
        if (name === 'Triplet Helix') {
            spacing = 2 / 3;
        } else if (section.key === 'chapel') {
            spacing = 0.5;
        }
        let phraseIndex = 0;
        for (let phraseStart = windowStart; phraseStart < windowEnd; phraseStart += phraseLength, phraseIndex++) {
            const isDrop = section.key === 'drop-one' || section.key === 'drop-two';
            if (isDrop && exchangeLeadIndex >= 0 && phraseIndex % 2 !== exchangeLeadIndex) {
                continue;
            }
            for (let cellIndex = 0; cellIndex < CELL.length; cellIndex++) {
                const beat = phraseStart + displacement + cellIndex * spacing;
                const duration = family === 'atmosphere' ? 1.5 : 0.42 + ((trackIndex + cellIndex) % 3) * 0.09;
                if (beat + duration > windowEnd) {
                    continue;
                }
                seeds.push({
                    beat,
                    duration,
                    velocity: 71 + ((trackIndex * 3 + cellIndex * 5 + sectionIndex) % 17) * 3,
                    pitch: pitchFor({ spec, trackIndex, sectionIndex, cellIndex }),
                });
            }
        }
    }
    return seeds;
}

function chapelOrganicSeeds(spec: VoiceSpec, trackIndex: number, sectionIndex: number): NoteSeed[] {
    const [name] = spec;
    const seeds: NoteSeed[] = [];
    for (let bar = 0; bar < 8; bar++) {
        const isCallBar = bar % 2 === 0;
        if ((name === 'Levain Call' && !isCallBar) || (name === 'Levain Answer' && isCallBar)) {
            continue;
        }
        const offsets = name === 'Grand Boule Ritual' ? [1.125, 2.625] : [0.125, 0.875, 1.625, 2.625];
        for (const [cellIndex, offset] of offsets.entries()) {
            seeds.push({
                beat: 288 + bar * 3.5 + offset,
                duration: name === 'Grand Boule Ritual' ? 0.9 : 0.55,
                velocity: 79 + ((bar + cellIndex) % 4) * 6,
                pitch: pitchFor({ spec, trackIndex, sectionIndex, cellIndex }),
            });
        }
    }
    for (let beat = 316; beat < 352; beat += 8) {
        for (let cellIndex = 0; cellIndex < CELL.length; cellIndex++) {
            seeds.push({
                beat: beat + 0.125 + cellIndex,
                duration: 0.65,
                velocity: 81 + cellIndex * 5,
                pitch: pitchFor({ spec, trackIndex, sectionIndex, cellIndex }),
            });
        }
    }
    return seeds;
}

function dropOrganicSeeds(spec: VoiceSpec, section: Section, trackIndex: number, sectionIndex: number): NoteSeed[] {
    const [name] = spec;
    const seeds: NoteSeed[] = [];
    for (const [windowStart, windowEnd] of getWindows(section, name)) {
        let blockIndex = 0;
        for (let blockStart = windowStart; blockStart < windowEnd; blockStart += 8) {
            const selected = name === 'Grand Boule Ritual' || (name === 'Levain Call') === (blockIndex % 2 === 0);
            if (selected) {
                const offsets = name === 'Grand Boule Ritual' ? [4.875] : [1.125, 4.875];
                for (const [cellIndex, offset] of offsets.entries()) {
                    if (blockStart + offset + 0.7 <= windowEnd) {
                        seeds.push({
                            beat: blockStart + offset,
                            duration: name === 'Grand Boule Ritual' ? 1.25 : 0.7,
                            velocity: 84 + ((blockIndex + cellIndex) % 4) * 6,
                            pitch: pitchFor({
                                spec,
                                trackIndex,
                                sectionIndex,
                                cellIndex: cellIndex + blockIndex,
                            }),
                        });
                    }
                }
            }
            blockIndex++;
        }
    }
    return seeds;
}

function createSeeds(spec: VoiceSpec, section: Section, trackIndex: number, sectionIndex: number): NoteSeed[] {
    const [name, basePitch, family] = spec;
    if (name === 'Root Drone') {
        return getWindows(section, name).flatMap(([startBeat, endBeat]) =>
            Array.from({ length: Math.ceil((endBeat - startBeat) / 16) }, (_, index) => ({
                beat: startBeat + index * 16,
                duration: Math.min(15.5, endBeat - startBeat - index * 16),
                velocity: 58 + (index % 3) * 5,
                pitch: basePitch + SECTION_TRANSPOSITIONS[sectionIndex]!,
            }))
        );
    }
    if (family === 'organic' && section.key === 'chapel') {
        return chapelOrganicSeeds(spec, trackIndex, sectionIndex);
    }
    if (family === 'organic' && (section.key === 'drop-one' || section.key === 'drop-two')) {
        return dropOrganicSeeds(spec, section, trackIndex, sectionIndex);
    }
    return genericSeeds(spec, section, trackIndex, sectionIndex);
}

function createTrackPerformance(track: ProjectTrack, notesByClipId: Record<string, ProjectMidiNote[]>): ProjectTrack {
    const trackIndex = VOICES.findIndex(([name]) => name === track.name);
    if (trackIndex < 0) {
        return track;
    }
    const spec = VOICES[trackIndex]!;
    const clips = SECTIONS.flatMap((section, sectionIndex): ProjectClip[] => {
        if (!ACTIVE_TRACKS[section.key].includes(track.name)) {
            return [];
        }
        const clipId = createMyceliumId('voice-clip', `${track.name}:${section.key}`);
        const seeds = createSeeds(spec, section, trackIndex, sectionIndex);
        notesByClipId[clipId] = seeds.map((seed, noteIndex) => ({
            id: createMyceliumId('voice-note', `${track.name}:${section.key}:${noteIndex}`),
            pitch: seed.pitch,
            startBeat: seed.beat - section.startBeat,
            duration: seed.duration,
            velocity: seed.velocity,
        }));
        return [
            {
                id: clipId,
                trackId: track.id,
                name: `${track.name} — ${section.name}`,
                startBeat: section.startBeat,
                endBeat: section.endBeat,
                type: 'midi',
                fadeInBeats: 0,
                fadeOutBeats: 0,
                gain: 1,
                color: track.color,
                locked: false,
                muted: false,
            },
        ];
    });
    const generatedIds = new Set(clips.map((clip) => clip.id));
    return { ...track, clips: [...track.clips.filter((clip) => !generatedIds.has(clip.id)), ...clips] };
}

export function createMyceliumVoicePerformance(projectData: ProjectData): ProjectData {
    const notesByClipId = { ...projectData.midi.notesByClipId };
    const tracks = projectData.arrangement.tracks.map((track) => createTrackPerformance(track, notesByClipId));
    const midi = { ...projectData.midi, notesByClipId };
    const arrangements = projectData.arrangements?.map((arrangement) => {
        if (arrangement.id !== projectData.activeArrangementId) {
            return arrangement;
        }
        return {
            ...arrangement,
            tracks: { tracks, selectedTrackId: arrangement.tracks?.selectedTrackId ?? null },
            midi: {
                notesByClipId: midi.notesByClipId,
                ccByClipId: midi.ccByClipId,
                pitchBendByClipId: midi.pitchBendByClipId,
            },
        };
    });
    return { ...projectData, arrangement: { tracks }, midi, arrangements };
}
