import { createMyceliumId } from './createMyceliumId';

import type { ProjectClip, ProjectData, ProjectMidiNote, ProjectTrack } from '../../../models/ProjectData';

type RhythmSection = {
    key: 'germination' | 'pressure' | 'drop-one' | 'chapel' | 'build' | 'drop-two' | 'dissolution';
    name: string;
    startBeat: number;
    endBeat: number;
};

type NoteSeed = { beat: number; duration: number; velocity: number };
type DropPattern = {
    offsets: readonly number[];
    step: number;
    duration: number;
    velocity: number;
};

const SECTIONS: readonly RhythmSection[] = [
    { key: 'germination', name: 'First Germination', startBeat: 64, endBeat: 128 },
    { key: 'pressure', name: 'Pressure Bloom', startBeat: 128, endBeat: 192 },
    { key: 'drop-one', name: 'Drop I', startBeat: 192, endBeat: 288 },
    { key: 'chapel', name: 'Psilocybin Chapel', startBeat: 288, endBeat: 352 },
    { key: 'build', name: 'Singularity Build', startBeat: 352, endBeat: 416 },
    { key: 'drop-two', name: 'Drop II', startBeat: 416, endBeat: 544 },
    { key: 'dissolution', name: 'Dissolution', startBeat: 544, endBeat: 576 },
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

const DROP_ONE_RANGES = [[192, 288]] as const;
const DROP_TWO_RANGES = [[416, 544]] as const;

function stepped(startBeat: number, endBeat: number, step: number, duration: number, velocity: number): NoteSeed[] {
    const count = Math.ceil((endBeat - startBeat) / step);
    const velocityOffsets = [0, 7, 3, 5] as const;
    const durationFactors = [1, 0.94, 0.88, 0.94] as const;
    return Array.from({ length: count }, (_, index) => ({
        beat: startBeat + index * step,
        duration: duration * durationFactors[index % durationFactors.length]!,
        velocity: velocity - velocityOffsets[index % velocityOffsets.length]!,
    })).filter((note) => note.beat < endBeat && note.beat + note.duration <= endBeat);
}

function fillSeeds(name: string, startBeat: number, endBeat: number, cadence: number): NoteSeed[] {
    const offsetsByName: Record<string, readonly number[]> = {
        Clap: [-1],
        Rim: [-2.5],
        'Low Tom': [-2],
        'Mid Tom': [-1.5],
        'Hi Tom': [-1, -0.5],
    };
    const offsets = offsetsByName[name];
    if (!offsets) {
        return [];
    }
    const seeds: NoteSeed[] = [];
    for (let blockStart = startBeat; blockStart < endBeat; blockStart += cadence) {
        const blockEnd = Math.min(blockStart + cadence, endBeat);
        const blockIndex = (blockStart - startBeat) / cadence;
        const duration = blockIndex % 2 === 0 ? 0.08 : 0.06;
        for (const [index, offset] of offsets.entries()) {
            seeds.push({
                beat: blockEnd + offset,
                duration,
                velocity: 84 + index * 4 + (blockIndex % 3) * 2,
            });
        }
    }
    return seeds;
}

function dropDrumSeeds(name: string, startBeat: number, endBeat: number, cadence: number): NoteSeed[] {
    const patterns: Record<string, DropPattern> = {
        Kick: { offsets: [0], step: 1, duration: 0.12, velocity: 124 },
        Snare: { offsets: [1, 3], step: 4, duration: 0.12, velocity: 104 },
        'Closed HH': { offsets: [0.5], step: 2, duration: 0.08, velocity: 86 },
        'Open HH': { offsets: [1.5], step: 2, duration: 0.16, velocity: 90 },
        Crash: { offsets: [0], step: cadence, duration: 0.24, velocity: 106 },
        Ride: { offsets: [2.75], step: 8, duration: 0.12, velocity: 78 },
        Cowbell: { offsets: [6.75], step: 16, duration: 0.1, velocity: 76 },
        Clave: { offsets: [10.5], step: 16, duration: 0.08, velocity: 78 },
        Shaker: { offsets: [0.25], step: 1, duration: 0.08, velocity: 72 },
        'Perc 1': { offsets: [3.25], step: 8, duration: 0.08, velocity: 78 },
        'Perc 2': { offsets: [7.75], step: 16, duration: 0.08, velocity: 76 },
    };
    const pattern = patterns[name];
    const regular = pattern
        ? pattern.offsets.flatMap((offset) =>
              stepped(startBeat + offset, endBeat, pattern.step, pattern.duration, pattern.velocity)
          )
        : [];
    return [...regular, ...fillSeeds(name, startBeat, endBeat, cadence)].sort((left, right) => left.beat - right.beat);
}

function peelSeeds(startBeat: number, duration: number, velocity: number): NoteSeed[] {
    return [
        ...stepped(startBeat, startBeat + 8, 1, duration, velocity),
        ...stepped(startBeat + 8, startBeat + 16, 2, duration, velocity - 10),
        ...stepped(startBeat + 16, startBeat + 24, 4, duration, velocity - 20),
        ...stepped(startBeat + 24, startBeat + 32, 8, duration, velocity - 30),
    ];
}

function drumSeeds(name: string, section: RhythmSection): NoteSeed[] {
    if (section.key === 'germination') {
        if (name === 'Kick') {
            return stepped(64, 128, 8, 0.12, 91);
        }
        if (name === 'Shaker') {
            return stepped(65.5, 128, 4, 0.08, 68).map((note, index) => ({
                ...note,
                beat: note.beat + (index % 2) * 0.25,
            }));
        }
        return [];
    }
    if (section.key === 'pressure') {
        if (name === 'Kick') {
            return [
                ...stepped(128, 160, 4, 0.12, 96),
                ...stepped(160, 176, 2, 0.12, 102),
                ...stepped(176, 191.75, 1, 0.12, 110),
            ];
        }
        if (name === 'Closed HH') {
            return [
                ...stepped(128.5, 160, 4, 0.08, 75),
                ...stepped(160.5, 176, 1, 0.08, 84),
                ...stepped(176.5, 191.75, 0.5, 0.08, 93),
            ];
        }
        if (name === 'Open HH') {
            return [...stepped(162.75, 176, 4, 0.12, 81), ...stepped(176.75, 191.75, 2, 0.12, 89)];
        }
        if (['Clap', 'Rim', 'Low Tom', 'Mid Tom', 'Hi Tom'].includes(name)) {
            return [...fillSeeds(name, 160, 176, 16), ...fillSeeds(name, 176, 191.75, 8)];
        }
        if (name === 'Shaker') {
            return [...stepped(144.25, 176, 2, 0.08, 76), ...stepped(176.25, 191.75, 1, 0.08, 84)];
        }
        return [];
    }
    if (section.key === 'drop-one') {
        return dropDrumSeeds(name, 192, 288, 32);
    }
    if (section.key === 'chapel') {
        if (name === 'Shaker') {
            return stepped(288.25, 316, 1, 0.08, 72);
        }
        if (name === 'Rim') {
            return stepped(288, 316, 3.5, 0.08, 86);
        }
        if (name === 'Clap') {
            return stepped(289.5, 316, 3.5, 0.08, 84);
        }
        return name === 'Kick' ? stepped(316, 352, 2, 0.12, 104) : [];
    }
    if (section.key === 'build') {
        if (name === 'Hi Tom') {
            return [
                ...stepped(352, 384, 4, 0.08, 81),
                ...stepped(384, 400, 1, 0.08, 87),
                ...stepped(400, 408, 0.5, 0.08, 92),
                ...stepped(408, 412, 0.25, 0.08, 98),
                ...stepped(412, 415.75, 0.125, 0.06, 104),
            ];
        }
        return name === 'Kick' ? stepped(352, 415.75, 4, 0.12, 94) : [];
    }
    if (section.key === 'drop-two') {
        return dropDrumSeeds(name, 416, 544, 16);
    }
    if (name === 'Kick') {
        return peelSeeds(544, 0.12, 104);
    }
    if (name === 'Closed HH') {
        return peelSeeds(544, 0.08, 81);
    }
    return [];
}

function bassSeeds(name: string, section: RhythmSection): NoteSeed[] {
    if (name === 'Sub Mycelium' && section.key === 'germination') {
        return stepped(71.5, 128, 16, 0.14, 58);
    }
    if (name === 'Rolling Colony' && section.key === 'pressure') {
        return [
            ...stepped(128.25, 160, 8, 0.16, 72),
            ...stepped(160.25, 176, 2, 0.16, 82),
            ...stepped(176.25, 191.75, 1, 0.16, 94),
        ];
    }
    if (name === 'Rolling Colony' && (section.key === 'drop-one' || section.key === 'drop-two')) {
        const ranges = section.key === 'drop-one' ? DROP_ONE_RANGES : DROP_TWO_RANGES;
        return ranges.flatMap(([startBeat, endBeat]) =>
            stepped(startBeat, endBeat, 1, 0.16, 114).flatMap((pulse, index) =>
                [0.25, 0.5, 0.75].map((offset, noteIndex) => ({
                    beat: pulse.beat + offset,
                    duration: [0.16, 0.18, 0.14][noteIndex]!,
                    velocity: 104 + ((index + noteIndex) % 5) * 3,
                }))
            )
        );
    }
    if (section.key === 'drop-one' || section.key === 'drop-two') {
        const ranges = section.key === 'drop-one' ? DROP_ONE_RANGES : DROP_TWO_RANGES;
        const offset = name === 'Sub Mycelium' ? 0.75 : 1.75;
        return ranges.flatMap(([startBeat, endBeat]) => stepped(startBeat + offset, endBeat, 4, 0.22, 91));
    }
    if (name === 'Acid Tendril' && section.key === 'pressure') {
        return stepped(160.5, 191.75, 4, 0.18, 86);
    }
    if (name === 'Sub Mycelium' && section.key === 'chapel') {
        return stepped(288.25, 316, 4, 0.22, 91);
    }
    if (name === 'Rolling Colony' && section.key === 'chapel') {
        return stepped(316.25, 352, 2, 0.16, 89);
    }
    if ((name === 'Rolling Colony' || name === 'Acid Tendril') && section.key === 'build') {
        const offset = name === 'Rolling Colony' ? 0.5 : 1.25;
        return stepped(352 + offset, 415.75, 4, 0.16, 91);
    }
    if (section.key === 'dissolution') {
        return peelSeeds(544.25, 0.16, 91);
    }
    return [];
}

function createTrackPerformance(track: ProjectTrack, notesByClipId: Record<string, ProjectMidiNote[]>): ProjectTrack {
    const padIndex = PAD_NAMES.indexOf(track.name as (typeof PAD_NAMES)[number]);
    if (padIndex < 0 && !['Sub Mycelium', 'Rolling Colony', 'Acid Tendril'].includes(track.name)) {
        return track;
    }
    let pitch = 57;
    if (padIndex >= 0) {
        pitch = 36 + padIndex;
    } else if (track.name === 'Sub Mycelium') {
        pitch = 33;
    } else if (track.name === 'Rolling Colony') {
        pitch = 45;
    }
    const clips = SECTIONS.flatMap((section): ProjectClip[] => {
        const seeds = padIndex >= 0 ? drumSeeds(track.name, section) : bassSeeds(track.name, section);
        if (seeds.length === 0) {
            return [];
        }
        const clipId = createMyceliumId('rhythm-clip', `${track.name}:${section.key}`);
        notesByClipId[clipId] = seeds.map((seed, index) => ({
            id: createMyceliumId('rhythm-note', `${track.name}:${section.key}:${index}`),
            pitch,
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
    return { ...track, clips };
}

export function createMyceliumRhythmPerformance(projectData: ProjectData): ProjectData {
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
