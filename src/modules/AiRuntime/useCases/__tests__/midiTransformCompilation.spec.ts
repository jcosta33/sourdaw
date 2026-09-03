import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MIDI_TRANSFORM_IMPLEMENTATIONS } from '#/modules/AiGeneration/useCases';
import { clearMidiTransformRegistry, registerMidiTransforms } from '#/modules/Command/stores';
import { ADD_NOTES_MAX_NOTES_PER_COMMAND, MIDI_NOTE_MIN_DURATION_BEATS } from '#/utils/midiNoteBatchLimits';

import {
    SEMANTIC_COMMAND_LIST_MAX_COMMANDS,
    SEMANTIC_COMMAND_LIST_MAX_CREATIONS,
} from '../../models/SemanticCommandList';
import { compileArbitraryCommandList } from '../compileArbitraryCommandList';
import { getAgentToolCatalogEntries } from '../getAgentToolCatalogEntries';
import { validateArbitraryCommandListEvidence } from '../validateArbitraryCommandListEvidence';

const midiTrack = {
    id: 'track-midi',
    name: 'MIDI',
    kind: 'midi' as const,
    muted: false,
    soloed: false,
    soloSafe: false,
    armed: false,
    gain: 1,
    pan: 0,
    automationMode: 'read' as const,
    clipCount: 0,
    deviceCount: 0,
    clips: [] as Array<{
        id: string;
        name: string;
        type: 'midi';
        startBeat: number;
        endBeat: number;
        noteCount: number;
    }>,
    devices: [],
};

const context = {
    tempo: 120,
    timeSignature: [4, 4] as [number, number],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 16,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 16,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    tracks: [midiTrack],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange' as const,
    playheadPosition: 0,
};

const existingClipContext = {
    ...context,
    tracks: [
        {
            ...midiTrack,
            clipCount: 1,
            clips: [{ id: 'clip-verse', name: 'Verse', type: 'midi' as const, startBeat: 0, endBeat: 8, noteCount: 0 }],
        },
    ],
};

const plan = (targetIds: string[]) => ({
    semantic: { classification: 'simple', uncertainty: [] },
    objective: 'Write a backing part into the requested clip.',
    constraints: [],
    scope: { targetIds, targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
    capabilityIds: [],
    assetIds: [],
    alternatives: [],
    validationStrategy: [],
    stoppingConditions: [],
});

/** Three notes at the head of the clip: enough to observe, small enough to fit any span used here. */
const threeNotes = () =>
    Array.from({ length: 3 }, (_unused, index) => ({
        pitch: 60 + index,
        startBeat: index,
        duration: 1,
        velocity: 90,
    }));

function propose(items: readonly unknown[], targetIds: string[] = []) {
    return {
        name: 'command.batch.propose',
        arguments: { plan: plan(targetIds), list: { schemaVersion: 1, items } },
    };
}

const createdClipItems = [
    { id: 'make-track', name: 'addTrack', arguments: { name: 'Lead', kind: 'midi', binding: 'lead' } },
    {
        id: 'make-clip',
        name: 'addClip',
        arguments: { trackId: '$lead', startBeat: 0, endBeat: 32, name: 'Verse', binding: 'verse' },
        dependsOn: ['make-track'],
    },
];

function chordProgressionItem(transformArguments: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    return {
        id: 'write-chords',
        name: 'chordProgression',
        arguments: transformArguments,
        dependsOn: ['make-clip'],
        ...extra,
    };
}

describe('MIDI transform compilation', () => {
    beforeEach(() => {
        clearMidiTransformRegistry();
        registerMidiTransforms({
            chordProgression: threeNotes,
            drumPattern: threeNotes,
            melody: threeNotes,
        });
    });

    afterEach(() => {
        clearMidiTransformRegistry();
    });

    it('expands a transform on a clip the same batch creates into addNotes on that clip', () => {
        const result = compileArbitraryCommandList({
            context,
            revision: 'revision-transform',
            calls: [
                propose([
                    ...createdClipItems,
                    chordProgressionItem({
                        clipId: '$verse',
                        style: 'blues',
                        key: 0,
                        scale: 'major',
                        bars: 8,
                        seed: 7,
                    }),
                ]),
            ],
        });

        expect(result).toMatchObject({ status: 'accepted' });
        if (result.status !== 'accepted' || result.compilerEvidence === undefined) {
            return;
        }
        const { commands } = result.compilerEvidence;
        expect(commands.map((command) => command.name)).toEqual(['addTrack', 'addClip', 'addNotes']);
        const addNotesCommands = commands.filter((command) => command.name === 'addNotes');
        expect(addNotesCommands.every((command) => command.arguments.clipId === '$verse')).toBe(true);
        expect(addNotesCommands.flatMap((command) => command.arguments.notes as unknown[]).length).toBeGreaterThan(0);
        expect(result.compilerEvidence.expandedMidiTransforms).toEqual(['chordProgression']);
        expect(
            validateArbitraryCommandListEvidence({
                evidence: result.compilerEvidence,
                calls: result.compilerEvidence.commands,
                context,
                revision: 'revision-transform',
            })
        ).toMatchObject({ status: 'accepted' });
    });

    it('rejects a transform whose bars do not fit the clip the batch creates', () => {
        const result = compileArbitraryCommandList({
            context,
            revision: 'revision-transform',
            calls: [
                propose([
                    ...createdClipItems,
                    chordProgressionItem({ clipId: '$verse', style: 'blues', bars: 12, seed: 7 }),
                ]),
            ],
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'MIDI transform chordProgression spans 48 beats but its clip spans 32 beats.',
        });
    });

    it('rejects a repeated transform item', () => {
        const result = compileArbitraryCommandList({
            context,
            revision: 'revision-transform',
            calls: [
                propose([
                    ...createdClipItems,
                    chordProgressionItem({ clipId: '$verse', bars: 4, seed: 7 }, { repeat: { count: 3 } }),
                ]),
            ],
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'MIDI transform chordProgression is not one bounded item without a selector.',
        });
    });

    it('rejects a transform that carries a bulk selector', () => {
        const result = compileArbitraryCommandList({
            context: existingClipContext,
            revision: 'revision-transform',
            calls: [
                propose([
                    {
                        id: 'write-chords',
                        name: 'chordProgression',
                        arguments: { bars: 1, seed: 7 },
                        selector: {
                            targetArgument: 'clipId',
                            entity: 'clip',
                            where: { name: 'Verse' },
                            quantity: { unit: 'targets', exactly: 1 },
                        },
                    },
                ]),
            ],
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'MIDI transform chordProgression is not one bounded item without a selector.',
        });
    });

    it('expands a transform on an existing MIDI clip into addNotes on that clip id', () => {
        const result = compileArbitraryCommandList({
            context: existingClipContext,
            revision: 'revision-transform',
            calls: [
                propose(
                    [
                        {
                            id: 'write-chords',
                            name: 'chordProgression',
                            arguments: { clipId: 'clip-verse', bars: 2, seed: 7 },
                        },
                    ],
                    []
                ),
            ],
        });

        expect(result).toMatchObject({ status: 'accepted' });
        if (result.status !== 'accepted' || result.compilerEvidence === undefined) {
            return;
        }
        expect(result.compilerEvidence.commands.map((command) => command.name)).toEqual(['addNotes']);
        expect(result.compilerEvidence.commands[0]?.arguments.clipId).toBe('clip-verse');
        expect(
            validateArbitraryCommandListEvidence({
                evidence: result.compilerEvidence,
                calls: result.compilerEvidence.commands,
                context: existingClipContext,
                revision: 'revision-transform',
            })
        ).toMatchObject({ status: 'accepted' });
    });

    it('rejects a transform aimed at a clip outside the writable MIDI clip contract', () => {
        const result = compileArbitraryCommandList({
            context: existingClipContext,
            revision: 'revision-transform',
            calls: [
                propose([
                    {
                        id: 'write-chords',
                        name: 'chordProgression',
                        arguments: { clipId: 'clip-missing', bars: 1, seed: 7 },
                    },
                ]),
            ],
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'MIDI transform target clip-missing is outside the writable MIDI clip contract.',
        });
    });

    const clipItems = (count: number) =>
        Array.from({ length: count }, (_unused, index) => ({
            id: `make-clip-${String(index)}`,
            name: 'addClip',
            arguments: {
                trackId: '$lead',
                startBeat: index * 32,
                endBeat: index * 32 + 32,
                name: `Section ${String(index)}`,
                ...(index === 0 ? { binding: 'verse' } : {}),
            },
            dependsOn: ['make-track'],
        }));

    it.each([
        { accepted: false, clipCount: SEMANTIC_COMMAND_LIST_MAX_CREATIONS },
        { accepted: true, clipCount: SEMANTIC_COMMAND_LIST_MAX_CREATIONS - 1 },
    ])('counts only created objects against the creation budget with $clipCount clips', (scenario) => {
        const result = compileArbitraryCommandList({
            context,
            revision: 'revision-transform',
            calls: [
                propose([
                    createdClipItems[0]!,
                    ...clipItems(scenario.clipCount),
                    { ...chordProgressionItem({ clipId: '$verse', bars: 8, seed: 7 }), dependsOn: ['make-clip-0'] },
                ]),
            ],
        });

        expect(result.status).toBe(scenario.accepted ? 'accepted' : 'rejected');
    });

    it('expands a swung drum pattern that fills its clip into addNotes that end inside it', () => {
        clearMidiTransformRegistry();
        registerMidiTransforms(MIDI_TRANSFORM_IMPLEMENTATIONS);

        const result = compileArbitraryCommandList({
            context,
            revision: 'revision-transform',
            calls: [
                propose([
                    { id: 'c0', name: 'addTrack', arguments: { name: 'Drums', kind: 'midi', binding: 'kit' } },
                    {
                        id: 'c1',
                        name: 'addClip',
                        arguments: { trackId: '$kit', startBeat: 0, endBeat: 16, name: 'Beat', binding: 'drums' },
                        dependsOn: ['c0'],
                    },
                    {
                        id: 't1',
                        name: 'drumPattern',
                        arguments: { clipId: '$drums', bars: 4, style: 'punk', swing: 0.5 },
                        dependsOn: ['c1'],
                    },
                ]),
            ],
        });

        expect(result).toMatchObject({ status: 'accepted' });
        if (result.status !== 'accepted' || result.compilerEvidence === undefined) {
            return;
        }
        const { commands } = result.compilerEvidence;
        expect(commands.map((command) => command.name)).toEqual(['addTrack', 'addClip', 'addNotes']);
        const notes = commands
            .filter((command) => command.name === 'addNotes')
            .flatMap((command) => command.arguments.notes as { startBeat: number; duration: number }[]);
        expect(notes.length).toBeGreaterThan(0);
        expect(Math.max(...notes.map((note) => note.startBeat + note.duration))).toBeLessThanOrEqual(16);
        expect(Math.min(...notes.map((note) => note.duration))).toBeGreaterThanOrEqual(MIDI_NOTE_MIN_DURATION_BEATS);
    });

    /** A generator wide enough that one transform costs several `addNotes`, on the tightest legal grid. */
    const packedNotes = (count: number) => () =>
        Array.from({ length: count }, (_unused, index) => ({
            pitch: 60,
            startBeat: index * 0.125,
            duration: MIDI_NOTE_MIN_DURATION_BEATS,
            velocity: 90,
        }));

    const wideClipItems = (count: number) => [
        { id: 'make-track', name: 'addTrack', arguments: { name: 'Lead', kind: 'midi', binding: 'lead' } },
        ...Array.from({ length: count }, (_unused, index) => ({
            id: `wide-clip-${String(index)}`,
            name: 'addClip',
            arguments: {
                trackId: '$lead',
                startBeat: index * 64,
                endBeat: index * 64 + 64,
                name: `Wide ${String(index)}`,
                binding: `wide${String(index)}`,
            },
            dependsOn: ['make-track'],
        })),
    ];

    const wideTransformItem = (index: number, name: string) => ({
        id: `wide-transform-${String(index)}`,
        name,
        arguments: { clipId: `$wide${String(index)}`, bars: 16, seed: 7 },
        dependsOn: [`wide-clip-${String(index)}`],
    });

    it.each([
        { accepted: false, clipCount: 11 },
        { accepted: true, clipCount: 10 },
    ])('holds the application command budget across an expansion with $clipCount created clips', (scenario) => {
        const wideCount = 4 * ADD_NOTES_MAX_NOTES_PER_COMMAND;
        clearMidiTransformRegistry();
        registerMidiTransforms({
            chordProgression: packedNotes(wideCount),
            drumPattern: packedNotes(1),
            melody: packedNotes(1),
        });
        const wideChunks = wideCount / ADD_NOTES_MAX_NOTES_PER_COMMAND;
        const items = [
            ...wideClipItems(scenario.clipCount),
            ...[0, 1, 2].map((index) => wideTransformItem(index, 'chordProgression')),
            wideTransformItem(3, 'melody'),
        ];
        const orderedCommandCount = 1 + scenario.clipCount + 3 * wideChunks + 1;

        expect(orderedCommandCount).toBe(SEMANTIC_COMMAND_LIST_MAX_COMMANDS + (scenario.accepted ? 0 : 1));
        const result = compileArbitraryCommandList({
            context,
            revision: 'revision-transform',
            calls: [propose(items)],
        });

        if (scenario.accepted) {
            expect(result).toMatchObject({ status: 'accepted' });
            return;
        }
        expect(result).toEqual({
            status: 'rejected',
            reason: 'Structured command list exceeds the application command budget.',
        });
    });

    it('refuses two transforms writing the same created clip', () => {
        const result = compileArbitraryCommandList({
            context,
            revision: 'revision-transform',
            calls: [
                propose([
                    ...createdClipItems,
                    chordProgressionItem({ clipId: '$verse', bars: 4, seed: 7 }),
                    {
                        id: 'write-more-chords',
                        name: 'melody',
                        arguments: { clipId: '$verse', bars: 4, seed: 9 },
                        dependsOn: ['make-clip'],
                    },
                ]),
            ],
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Structured command writes for addNotes on $verse are not safely composable.',
        });
    });

    it('admits two transforms writing two created clips', () => {
        const result = compileArbitraryCommandList({
            context,
            revision: 'revision-transform',
            calls: [
                propose([
                    ...createdClipItems,
                    {
                        id: 'make-second-clip',
                        name: 'addClip',
                        arguments: {
                            trackId: '$lead',
                            startBeat: 32,
                            endBeat: 64,
                            name: 'Chorus',
                            binding: 'chorus',
                        },
                        dependsOn: ['make-track'],
                    },
                    chordProgressionItem({ clipId: '$verse', bars: 4, seed: 7 }),
                    {
                        id: 'write-more-chords',
                        name: 'melody',
                        arguments: { clipId: '$chorus', bars: 4, seed: 9 },
                        dependsOn: ['make-second-clip'],
                    },
                ]),
            ],
        });

        expect(result).toMatchObject({ status: 'accepted' });
    });

    it('returns a registered transform schema through catalog discovery', () => {
        const discovered = getAgentToolCatalogEntries({ category: 'command', names: ['chordProgression'] });

        expect(discovered.items).toMatchObject([
            {
                type: 'function',
                function: {
                    name: 'chordProgression',
                    parameters: {
                        required: ['clipId', 'bars'],
                        properties: {
                            bars: { type: 'integer', minimum: 1, maximum: 16 },
                            seed: { type: 'integer', minimum: 0, maximum: 2_147_483_647, default: 1 },
                        },
                    },
                },
            },
        ]);
    });
});
