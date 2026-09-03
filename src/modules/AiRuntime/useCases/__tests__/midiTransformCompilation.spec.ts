import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearMidiTransformRegistry, registerMidiTransforms } from '#/modules/Command/stores';

import { SEMANTIC_COMMAND_LIST_MAX_CREATIONS } from '../../models/SemanticCommandList';
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
