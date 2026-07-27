import { LEGACY_MIDI_PROBABILITY_SEED } from '#/modules/MIDI/stores';

import { CURRENT_PROJECT_VERSION, type ProjectData } from '../../../models/ProjectData';

import { createMyceliumAutomation } from './createMyceliumAutomation';
import { createMyceliumId } from './createMyceliumId';
import { createMyceliumRhythmPerformance } from './createMyceliumRhythmPerformance';
import { createMyceliumTopology } from './createMyceliumTopology';
import { createMyceliumVoicePerformance } from './createMyceliumVoicePerformance';

export type MyceliumSection = {
    id: string;
    name: string;
    startBeat: number;
    endBeat: number;
    color: string;
};

export type MyceliumChordEvent = {
    id: string;
    beat: number;
    root: number;
    quality: '7' | 'maj7' | 'min9';
    duration: number;
};

export type MyceliumAscendantBlueprint = {
    projectData: ProjectData;
    sections: MyceliumSection[];
    chordEvents: MyceliumChordEvent[];
};

const SECTION_SPECS = [
    ['Sporefall', 0, 64],
    ['First Germination', 64, 128],
    ['Pressure Bloom', 128, 192],
    ['Drop I — Hyphal Drive', 192, 288],
    ['Psilocybin Chapel', 288, 352],
    ['Singularity Build', 352, 416],
    ['Drop II — Fractal Bloom', 416, 544],
    ['Dissolution', 544, 576],
] as const;

const MARKER_SPECS = [
    ['Sporefall', 0],
    ['Pulse Emerges', 48],
    ['First Germination', 64],
    ['Pressure Bloom', 128],
    ['Vacuum I', 188],
    ['Drop I — Hyphal Drive', 192],
    ['Psilocybin Chapel', 288],
    ['Grid Restored', 316],
    ['Singularity Build', 352],
    ['Vacuum II', 412],
    ['Drop II — Fractal Bloom', 416],
    ['False Floor', 480],
    ['Return Strike', 484],
    ['Dissolution', 544],
    ['Last Signal', 568],
] as const;

const CHORD_PATTERN = [
    [4, '7'],
    [5, 'maj7'],
    [2, 'min9'],
    [9, 'min9'],
] as const;

export function createMyceliumAscendantBlueprint(): MyceliumAscendantBlueprint {
    const topology = createMyceliumTopology();
    const sections = SECTION_SPECS.map(([name, startBeat, endBeat], index) => ({
        id: createMyceliumId('section', name),
        name,
        startBeat,
        endBeat,
        color: `oklch(0.42 0.09 ${250 + index * 12})`,
    }));
    const chordEvents = Array.from({ length: 36 }, (_, index): MyceliumChordEvent => {
        const [root, quality] = CHORD_PATTERN[index % CHORD_PATTERN.length]!;
        return {
            id: createMyceliumId('chord', String(index)),
            beat: index * 16,
            root,
            quality,
            duration: 16,
        };
    });
    const projectData: ProjectData = {
        version: CURRENT_PROJECT_VERSION,
        meta: {
            name: 'Mycelium Ascendant',
            createdAt: 0,
            updatedAt: 0,
            keyRoot: 9,
            scaleName: 'harmonic-minor',
            tuning: {
                name: 'Equal Temperament',
                frequencies: Array.from({ length: 128 }, (_, index) => 440 * 2 ** ((index - 69) / 12)),
            },
        },
        transport: {
            tempo: 144,
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
            loopStart: 0,
            loopEnd: 576,
            isLooping: true,
            metronomeEnabled: false,
            metronomeVolume: 0.7,
            punchInEnabled: false,
            punchInBeat: 0,
            punchOutBeat: 576,
            countInEnabled: false,
            countInBars: 1,
            preRollEnabled: false,
            preRollBars: 1,
            masterGain: 100,
        },
        arrangement: { tracks: topology.tracks },
        automation: { lanes: [] },
        midi: {
            probabilitySeed: LEGACY_MIDI_PROBABILITY_SEED,
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        },
        chordTrack: { enabled: true, events: chordEvents },
        sidechainRoutes: topology.sidechainRoutes,
        mixer: { master: { gain: 0.8, pan: 0 }, buses: [] },
        markers: MARKER_SPECS.map(([name, beat], index) => ({
            id: createMyceliumId('marker', `${index}:${name}`),
            beat,
            name,
            color: `oklch(0.42 0.09 ${250 + index * 7})`,
        })),
        tempoMap: {
            changes: [
                { id: createMyceliumId('tempo', '0'), beat: 0, tempo: 144, curve: 'instant' },
                { id: createMyceliumId('tempo', '1'), beat: 352, tempo: 144, curve: 'linear' },
                { id: createMyceliumId('tempo', '2'), beat: 416, tempo: 146, curve: 'instant' },
                { id: createMyceliumId('tempo', '3'), beat: 544, tempo: 146, curve: 'linear' },
                { id: createMyceliumId('tempo', '4'), beat: 576, tempo: 144, curve: 'instant' },
            ],
        },
        timeSignatureMap: {
            changes: [
                { id: createMyceliumId('meter', '0'), beat: 0, numerator: 4, denominator: 4 },
                { id: createMyceliumId('meter', '1'), beat: 288, numerator: 7, denominator: 8 },
                { id: createMyceliumId('meter', '2'), beat: 316, numerator: 4, denominator: 4 },
            ],
        },
        history: { checkpoints: [] },
    };
    const activeArrangementId = createMyceliumId('arrangement', 'primary');
    projectData.arrangements = [
        {
            id: activeArrangementId,
            name: 'Mycelium Ascendant',
            tracks: { tracks: projectData.arrangement.tracks, selectedTrackId: null },
            automation: projectData.automation,
            midi: {
                notesByClipId: projectData.midi.notesByClipId,
                ccByClipId: projectData.midi.ccByClipId,
                pitchBendByClipId: projectData.midi.pitchBendByClipId,
            },
            tempoMap: {
                changes:
                    projectData.tempoMap?.changes.map((change, index) => ({
                        ...change,
                        id: change.id ?? createMyceliumId('tempo', `arrangement:${index}`),
                        curve: change.curve ?? 'instant',
                    })) ?? [],
            },
            timeSignatureMap: {
                changes:
                    projectData.timeSignatureMap?.changes.map((change, index) => ({
                        ...change,
                        id: change.id ?? createMyceliumId('meter', `arrangement:${index}`),
                    })) ?? [],
            },
            markers: { markers: projectData.markers, sections },
            takeLanes: { lanes: [] },
        },
    ];
    projectData.activeArrangementId = activeArrangementId;

    const rhythmProjectData = createMyceliumRhythmPerformance(projectData);
    const performanceProjectData = createMyceliumVoicePerformance(rhythmProjectData);
    const automated = createMyceliumAutomation(performanceProjectData.arrangement.tracks);
    const automation = { lanes: automated.lanes };
    const automatedProjectData: ProjectData = {
        ...performanceProjectData,
        arrangement: { tracks: automated.tracks },
        automation,
        arrangements: performanceProjectData.arrangements?.map((arrangement) => {
            if (arrangement.id !== activeArrangementId) {
                return arrangement;
            }
            return {
                ...arrangement,
                tracks: { tracks: automated.tracks, selectedTrackId: arrangement.tracks?.selectedTrackId ?? null },
                automation,
            };
        }),
    };
    return { projectData: automatedProjectData, sections, chordEvents };
}
