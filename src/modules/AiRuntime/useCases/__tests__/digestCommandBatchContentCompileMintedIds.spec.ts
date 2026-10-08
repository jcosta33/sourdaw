import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore, type Clip, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    migrateLegacyAppActionToVersionedCommandEnvelope,
    parseVersionedCommandBatchEnvelope,
} from '#/modules/Command/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../../models/ProjectContext';
import { compilePlannedActionCommandBatch } from '../compilePlannedActionCommandBatch';
import { digestCommandBatchContent } from '../digestCommandBatchContent';
import { materializeActionStateGuards } from '../materializeActionStateGuards';

const mocks = vi.hoisted(() => ({ getCachedAudioBuffer: vi.fn() }));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
}));

const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
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
    sections: [{ id: 'section-verse', name: 'Verse', startBeat: 0, endBeat: 16 }],
    tracks: [],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

function createClip(overrides: Pick<Clip, 'id' | 'trackId'> & Partial<Clip>): Clip {
    return {
        name: 'Clip',
        startBeat: 0,
        endBeat: 4,
        type: 'audio',
        audioBufferId: 'buffer-1',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ff0000',
        locked: false,
        muted: false,
        ...overrides,
    };
}

function createTrack(overrides: Pick<Track, 'id' | 'clips'> & Partial<Track>): Track {
    return {
        name: 'Track',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        devices: [],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        midiFx: [],
        ...overrides,
    };
}

type Compilation = {
    digest: string;
    /** The ids the compilation recorded as drawn for the objects it creates, by argument path. */
    assignedIds: Record<string, string>;
    /** The ids of the section render jobs the batch carries, which are not project entities. */
    renderJobIds: string[];
};

function readJobIds(jobs: unknown): string[] {
    if (!Array.isArray(jobs)) {
        return [];
    }
    return jobs.map((job: { jobId: string }) => job.jobId);
}

/** One compilation of `actions` as a measured preview compiles it, and what the batch hashes to. */
function compileOnce(actions: readonly AppAction[]): Compilation {
    const { commandBatch } = compilePlannedActionCommandBatch({
        actions,
        actionLabels: actions.map((action) => action.type),
        autoCommit: false,
        context,
        group: { groupId: 'group-minted', groupLabel: 'Minted ids' },
        intent: 'Measure one preview.',
        mode: 'preview',
        projectRevision: 'revision-1',
        runId: 'run-minted',
    });
    const parsed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsed.status === 'invalid') {
        throw new Error(parsed.reason);
    }
    return {
        digest: digestCommandBatchContent(parsed.envelope),
        assignedIds: Object.fromEntries(
            parsed.envelope.commands.flatMap((command, index) =>
                command.applicationAssignedIds.map(({ argument, value }) => [
                    `${String(index)}.${command.operation}.${argument}`,
                    value,
                ])
            )
        ),
        renderJobIds: parsed.envelope.commands
            .filter((command) => command.operation === 'renderProjectSections')
            .flatMap((command) => readJobIds(command.arguments.jobs)),
    };
}

/**
 * Two compilations of one proposal, as a preview and its adopting proposal each compile it. The ids
 * the handlers draw differ between them; the hash of what the batch does must not.
 */
function compileTwice(prepare: () => readonly AppAction[]) {
    return { first: compileOnce(prepare()), second: compileOnce(prepare()) };
}

function expectStableHashOverFreshIds(
    compilations: { first: Compilation; second: Compilation },
    drawnArguments: readonly string[]
): void {
    expect(Object.keys(compilations.first.assignedIds)).toEqual(expect.arrayContaining([...drawnArguments]));
    for (const argument of drawnArguments) {
        expect(compilations.second.assignedIds[argument]).toBeDefined();
        expect(compilations.second.assignedIds[argument]).not.toBe(compilations.first.assignedIds[argument]);
    }
    expect(compilations.second.digest).toBe(compilations.first.digest);
}

beforeEach(() => {
    clearHandlerRegistry();
    registerHandlerMap(getArrangementHandlers());
    registerHandlerMap(getAudioRenderingHandlers());
});

afterEach(() => {
    clearHandlerRegistry();
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    automationStore.set({ lanes: [] });
    transportStore.set(defaultTransportState);
    vi.clearAllMocks();
});

describe('digestCommandBatchContent over ids a command draws while it compiles', () => {
    // Red when duplicateClipAt's copy id leaves the assigned-id record: it then hashes verbatim.
    it('hashes two compilations of a duplicateClipAt alike though each draws its own copy id', () => {
        const compilations = compileTwice(() => [
            {
                type: 'duplicateClipAt',
                payload: { clipId: 'clip-source', destinationTrackId: 'track-destination', startBeat: 8 },
            },
        ]);

        expectStableHashOverFreshIds(compilations, ['0.duplicateClipAt.targetClipId']);
    });

    it('tells apart duplicateClipAt batches that copy to different beats', () => {
        const copyTo = (startBeat: number): AppAction[] => [
            { type: 'duplicateClipAt', payload: { clipId: 'clip-source', destinationTrackId: 'track-1', startBeat } },
        ];

        expect(compileOnce(copyTo(8)).digest).not.toBe(compileOnce(copyTo(12)).digest);
    });

    describe('glueClips', () => {
        beforeEach(() => {
            const first = createClip({
                id: 'clip-a',
                trackId: 'track-midi',
                type: 'midi',
                startBeat: 8,
                endBeat: 12,
            });
            const second = createClip({
                id: 'clip-b',
                trackId: 'track-midi',
                type: 'midi',
                startBeat: 12,
                endBeat: 16,
            });
            const track = createTrack({ id: 'track-midi', kind: 'midi', clips: [first, second] });
            trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
            midiStore.set({
                notesByClipId: {
                    'clip-a': [{ id: 'note-a', pitch: 60, startBeat: 1, duration: 1, velocity: 100 }],
                    'clip-b': [{ id: 'note-b', pitch: 64, startBeat: 1, duration: 1, velocity: 100 }],
                },
                ccByClipId: {},
                pitchBendByClipId: {},
                migratedAbsoluteNoteClipIds: ['clip-a', 'clip-b'],
            });
            automationStore.set({
                lanes: ['gain', 'pan'].map((parameterId) => ({
                    id: `lane-${parameterId}`,
                    trackId: 'track-midi',
                    clipId: 'clip-a',
                    parameterId,
                    parameterName: parameterId,
                    points: [{ id: `point-${parameterId}`, beat: 9, value: 0.5, curve: 'linear', tension: 0 }],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                })),
            });
        });

        // Red when the glued clip's id or a migrated lane's id leaves the record: both hash verbatim.
        it('hashes two compilations alike though each draws its own glued clip and lane ids', () => {
            const compilations = compileTwice(() => [
                { type: 'glueClips', payload: { clipIds: ['clip-a', 'clip-b'] } },
            ]);

            expectStableHashOverFreshIds(compilations, [
                '0.glueClips.targetClipId',
                '0.glueClips.replacement.clipAutomationLanes[0].id',
                '0.glueClips.replacement.clipAutomationLanes[1].id',
            ]);
        });

        it('tells apart glue batches that join different clips', () => {
            const glue = (clipIds: string[]): AppAction[] => [{ type: 'glueClips', payload: { clipIds } }];

            expect(compileOnce(glue(['clip-a', 'clip-b'])).digest).not.toBe(
                compileOnce(glue(['clip-b', 'clip-a'])).digest
            );
        });
    });

    describe('splitClip', () => {
        beforeEach(() => {
            const clip = createClip({ id: 'clip-m', trackId: 'track-m', type: 'midi', startBeat: 0, endBeat: 8 });
            trackStore.set({
                tracks: [createTrack({ id: 'track-m', kind: 'midi', clips: [clip] })],
                selectedTrackId: 'track-m',
                ghostClips: [],
            });
            midiStore.set({
                notesByClipId: {
                    'clip-m': [
                        { id: 'note-x', pitch: 60, startBeat: 1, duration: 4, velocity: 100 },
                        { id: 'note-y', pitch: 64, startBeat: 0, duration: 1, velocity: 100 },
                    ],
                },
                ccByClipId: {},
                pitchBendByClipId: {},
                migratedAbsoluteNoteClipIds: ['clip-m'],
            });
        });

        // Red when the note a split cuts in two leaves the record: its right half's id hashes verbatim.
        it('hashes two compilations alike though each draws its own right clip and cut note ids', () => {
            const compilations = compileTwice(() => [{ type: 'splitClip', payload: { clipId: 'clip-m', beat: 3 } }]);

            expectStableHashOverFreshIds(compilations, ['0.splitClip.rightClipId', '0.splitClip.targetNoteIds[0]']);
        });

        it('tells apart split batches that cut at different beats', () => {
            const splitAt = (beat: number): AppAction[] => [{ type: 'splitClip', payload: { clipId: 'clip-m', beat } }];

            expect(compileOnce(splitAt(3)).digest).not.toBe(compileOnce(splitAt(6)).digest);
        });
    });

    describe('stripSilence', () => {
        const SAMPLES_PER_BEAT = 10;

        beforeEach(() => {
            const sampleRate = 100;
            const channelData = new Float32Array(20 * SAMPLES_PER_BEAT);
            channelData.fill(0.5, 0, 2 * SAMPLES_PER_BEAT);
            channelData.fill(0.5, 4 * SAMPLES_PER_BEAT, 6 * SAMPLES_PER_BEAT);
            channelData.fill(0.5, 10 * SAMPLES_PER_BEAT, 13 * SAMPLES_PER_BEAT);
            mocks.getCachedAudioBuffer.mockReturnValue({
                duration: channelData.length / sampleRate,
                getChannelData: () => channelData,
                length: channelData.length,
                numberOfChannels: 1,
                sampleRate,
            });
            transportStore.set({ ...defaultTransportState, tempo: 600 });
            const clip = createClip({
                id: 'clip-1',
                trackId: 'track-1',
                audioBufferId: 'buf-1',
                startBeat: 16,
                endBeat: 26,
                audioOffsetBeats: 3,
            });
            trackStore.set({
                tracks: [createTrack({ id: 'track-1', clips: [clip] })],
                selectedTrackId: 'track-1',
                ghostClips: [],
            });
            automationStore.set({
                lanes: [
                    {
                        id: 'lane-gain',
                        trackId: 'track-1',
                        clipId: 'clip-1',
                        parameterId: 'gain',
                        parameterName: 'Gain',
                        points: [
                            { id: 'point-early', beat: 17.5, value: 0.2, curve: 'linear', tension: 0 },
                            { id: 'point-late', beat: 24, value: 0.8, curve: 'linear', tension: 0 },
                        ],
                        objects: [],
                        visible: true,
                        enabled: true,
                        collapsed: false,
                        minValue: 0,
                        maxValue: 1,
                    },
                ],
            });
        });

        // stripSilence is not an executable registry command, so no batch compiles it and its envelope
        // is the whole compiled surface. Red when a segment's clip id or a migrated lane's id leaves
        // the assigned-id record: a hash over the envelope would then carry them verbatim.
        it('records every id its handler draws for a segment and a migrated lane, fresh per compilation', () => {
            const compile = () =>
                migrateLegacyAppActionToVersionedCommandEnvelope({
                    action: { type: 'stripSilence', payload: { clipId: 'clip-1' } },
                    expectedEffect: 'Strip silence',
                    normalizedProjectRevision: 'revision-1',
                });
            const readAssigned = (envelope: ReturnType<typeof compile>) =>
                Object.fromEntries(envelope.applicationAssignedIds.map(({ argument, value }) => [argument, value]));
            const drawn = [
                'replacement.clips[0].id',
                'replacement.clips[1].id',
                'replacement.clipAutomationLanes[0].id',
                'replacement.clipAutomationLanes[1].id',
            ];

            const first = readAssigned(compile());
            const second = readAssigned(compile());

            expect(Object.keys(first).toSorted()).toEqual(drawn.toSorted());
            for (const argument of drawn) {
                expect(second[argument]).toBeDefined();
                expect(second[argument]).not.toBe(first[argument]);
            }
        });
    });

    // Red when the arpeggio's added note ids leave the record, or the section render jobs' ids leave
    // the digest: the state guards draw them while a proposal is admitted, and the batch hashes them
    // verbatim.
    describe('ids the state guards draw while a proposal is admitted', () => {
        function guard(
            action: Parameters<typeof materializeActionStateGuards>[0][number],
            options: Parameters<typeof materializeActionStateGuards>[2]
        ) {
            const guarded = materializeActionStateGuards([action], context, options);
            if (guarded.status === 'rejected') {
                throw new Error(guarded.reason);
            }
            return guarded.actions;
        }

        it('hashes two admissions of one arpeggio alike though each draws its own note ids', () => {
            const compilations = compileTwice(() =>
                guard(
                    {
                        type: 'arpeggiate',
                        payload: { clipId: 'clip-chord', pattern: 'up', rate: 8, octaves: 1, gate: 50 },
                    },
                    {
                        syncopatedArpeggioScope: {
                            status: 'request',
                            trackId: 'track-midi',
                            trackName: 'Keys',
                            clipId: 'clip-chord',
                            clipName: 'Chords',
                            expectedTrackFrozen: false,
                            expectedClipLocked: false,
                            expectedNotes: [{ id: 'note-root', pitch: 60, startBeat: 0, duration: 4, velocity: 100 }],
                            addedNotes: [
                                { pitch: 60, startBeat: 0.5, duration: 0.5, velocity: 90 },
                                { pitch: 64, startBeat: 1.5, duration: 0.5, velocity: 90 },
                            ],
                            protectedObjects: [],
                        },
                    }
                )
            );

            expectStableHashOverFreshIds(compilations, [
                '0.arpeggiate.addedNotes[0].id',
                '0.arpeggiate.addedNotes[1].id',
            ]);
        });

        // A job is not a project entity: the batch receipt reads the assigned-id record as the objects a
        // later command can target and links jobs under `links.render`, so the record never names them.
        it('hashes two admissions of one section render alike though each draws its own job ids', () => {
            const compilations = compileTwice(() =>
                guard(
                    { type: 'renderProjectSections', payload: { sectionIds: ['section-verse'] } },
                    { appOwnedRenderTailSeconds: 2 }
                )
            );

            expect(compilations.first.renderJobIds).toHaveLength(1);
            expect(compilations.second.renderJobIds).toHaveLength(1);
            expect(compilations.second.renderJobIds).not.toEqual(compilations.first.renderJobIds);
            expect(compilations.second.digest).toBe(compilations.first.digest);
            expect(compilations.first.assignedIds).toEqual({});
        });
    });
});
