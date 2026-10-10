import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { captureCommandBatchPreflightState } from '#/app/captureCommandBatchPreflightState';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Clip, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { configureCollaborationAssetOwner } from '#/modules/Collaboration/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    commandBatchPreflightPort,
    executeAppActionBatch,
    executeVersionedCommandBatchEnvelope,
    parseVersionedCommandBatchEnvelope,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { type AppAction } from '#/utils/handlerContract';

import { compilePlannedActionCommandBatch } from '../compilePlannedActionCommandBatch';
import { getProjectContext } from '../getProjectContext';

import {
    configureAiWorkflowCommandCheckpointRuntime,
    resetAiWorkflowCommandCheckpointRuntime,
} from './aiWorkflowCommandCheckpointRuntime';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const TRACK_ID = 'track-midi';

function createMidiClip(id: string, startBeat: number): Clip {
    return {
        id,
        trackId: TRACK_ID,
        name: id,
        startBeat,
        endBeat: startBeat + 4,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ff0000',
        locked: false,
        muted: false,
    };
}

function createMidiTrack(clips: Clip[]): Track {
    return {
        id: TRACK_ID,
        name: 'Keys',
        kind: 'midi',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips,
        devices: [
            {
                id: 'device-drive',
                name: 'Distortion',
                type: 'builtin-distortion',
                bypassed: false,
                parameterValues: { 'dist-drive': 20 },
            },
            {
                id: 'device-phaser',
                name: 'Phaser',
                type: 'builtin-phaser',
                bypassed: false,
                parameterValues: { 'phaser-stages': 4 },
            },
        ],
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
    };
}

function seedProject(): void {
    trackStore.set({
        tracks: [createMidiTrack([createMidiClip('clip-a', 8), createMidiClip('clip-b', 12)])],
        selectedTrackId: TRACK_ID,
        ghostClips: [],
    });
    midiStore.set({
        notesByClipId: {
            'clip-a': [{ id: 'note-a', pitch: 60, startBeat: 1, duration: 1, velocity: 100 }],
            'clip-b': [{ id: 'note-b', pitch: 64, startBeat: 1, duration: 1, velocity: 100 }],
        },
        ccByClipId: {},
        pitchBendByClipId: {},
        migratedAbsoluteNoteClipIds: ['clip-a', 'clip-b'],
    });
    // Clip automation on the track's own device parameters: the compiled glue carries every source
    // lane.
    seedClipAutomation([
        { clipId: 'clip-a', parameterId: 'dist-drive' },
        { clipId: 'clip-a', parameterId: 'phaser-stages' },
    ]);
}

function seedClipAutomation(lanes: ReadonlyArray<{ clipId: string; parameterId: string }>): void {
    automationStore.set({
        lanes: lanes.map(({ clipId, parameterId }) => ({
            id: `lane-${parameterId}`,
            trackId: TRACK_ID,
            clipId,
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
    flushAutomergeStorageWrites();
}

const GLUE: AppAction[] = [{ type: 'glueClips', payload: { clipIds: ['clip-a', 'clip-b'] } }];

/** One glue proposal compiled for commit, as a confirmed or adopted proposal compiles it. */
function compileGlue() {
    return compilePlannedActionCommandBatch({
        actions: GLUE,
        actionLabels: ['Glue clips'],
        autoCommit: true,
        autoCommitApproval: () => ({ status: 'valid' as const }),
        context: getProjectContext(),
        group: { groupId: 'group-glue', groupLabel: 'Glue the intro' },
        intent: 'Glue the two intro clips.',
        mode: 'commit',
        projectRevision: captureProjectRevision(),
        runId: 'run-glue',
    }).commandBatch;
}

function readCompiledCommands(commandBatch: ReturnType<typeof compileGlue>) {
    const parsed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsed.status === 'invalid') {
        throw new Error(parsed.reason);
    }
    const { commands } = parsed.envelope;
    if (commands.length !== 1 || commands[0]?.operation !== 'glueClips') {
        throw new Error('Expected one compiled glue command');
    }
    return commands;
}

/** The ids the compiled glue recorded for what it creates, by argument path. */
function readRecordedIds(commandBatch: ReturnType<typeof compileGlue>): Record<string, string> {
    const [command] = readCompiledCommands(commandBatch);
    return Object.fromEntries(command!.applicationAssignedIds.map(({ argument, value }) => [argument, value]));
}

/** The compiled commands through the batch executor, as the serialized batch hands them to it. */
function executeCompiledCommands(commands: ReturnType<typeof readCompiledCommands>) {
    return executeAppActionBatch(
        commands.map((command) => ({ type: command.operation, payload: command.arguments }) as AppAction),
        { commandEnvelopes: commands, groupId: commands[0]?.groupId, source: 'prompt' }
    );
}

describe('a compiled glueClips command at execution', () => {
    beforeEach(() => {
        configureAiWorkflowCommandCheckpointRuntime();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('compiled glue execution test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        commandBatchPreflightPort.setProvider(captureCommandBatchPreflightState);
        configureCollaborationAssetOwner({ captureOwnerId: () => 'project:compiled-glue-execution' });
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        seedProject();
    });

    afterEach(() => {
        resetAiWorkflowCommandCheckpointRuntime();
        commandBatchPreflightPort.setProvider(null);
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        automationStore.set({ lanes: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    // Red when the handler plans the glue again at execution: the fresh glued clip and lane ids
    // break the arguments digest and the batch is refused as an envelope mismatch. The redo leg
    // replays what describe planned, so it names the recorded ids only if describe kept them too.
    it('commits, undoes and redoes the glue under the ids the command recorded', async () => {
        const commandBatch = compileGlue();
        const recorded = readRecordedIds(commandBatch);
        const recordedLaneIds = [
            recorded['replacement.clipAutomationLanes[0].id'],
            recorded['replacement.clipAutomationLanes[1].id'],
        ].toSorted();

        const committed = await executeVersionedCommandBatchEnvelope(commandBatch);

        expect(committed, JSON.stringify(committed)).toMatchObject({ status: 'committed' });
        expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.id)).toEqual([recorded.targetClipId]);
        expect(automationStore.value?.lanes.map((lane) => lane.id).toSorted()).toEqual(recordedLaneIds);
        expect(automationStore.value?.lanes.every((lane) => lane.clipId === recorded.targetClipId)).toBe(true);

        await undo();
        expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.id)).toEqual(['clip-a', 'clip-b']);

        await redo();
        expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.id)).toEqual([recorded.targetClipId]);
        expect(automationStore.value?.lanes.map((lane) => lane.id).toSorted()).toEqual(recordedLaneIds);
    });

    // Red when a lane's parameter id is read as an object the batch targets: a track parameter has
    // no project object, so the preflight refuses with `Command batch target does not exist: gain`.
    it('commits, undoes and redoes a glue whose clips carry gain and pan automation', async () => {
        seedClipAutomation([
            { clipId: 'clip-a', parameterId: 'gain' },
            { clipId: 'clip-b', parameterId: 'pan' },
        ]);
        const commandBatch = compileGlue();
        const recorded = readRecordedIds(commandBatch);
        const recordedLaneIds = Object.entries(recorded)
            .filter(([argument]) => argument.startsWith('replacement.clipAutomationLanes['))
            .map(([, laneId]) => laneId)
            .toSorted();
        const readLanes = () =>
            (automationStore.value?.lanes ?? [])
                .map(({ id, clipId, parameterId }) => ({ id, clipId, parameterId }))
                .toSorted((left, right) => left.parameterId.localeCompare(right.parameterId));
        const lanesBefore = readLanes();

        const committed = await executeVersionedCommandBatchEnvelope(commandBatch);

        expect(committed, JSON.stringify(committed)).toMatchObject({ status: 'committed' });
        expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.id)).toEqual([recorded.targetClipId]);
        const gluedLanes = readLanes();
        expect(gluedLanes.map(({ parameterId }) => parameterId)).toEqual(['gain', 'pan']);
        expect(gluedLanes.map(({ id }) => id).toSorted()).toEqual(recordedLaneIds);
        expect(gluedLanes.every(({ clipId }) => clipId === recorded.targetClipId)).toBe(true);

        await undo();
        expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.id)).toEqual(['clip-a', 'clip-b']);
        expect(readLanes()).toEqual(lanesBefore);

        await redo();
        expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.id)).toEqual([recorded.targetClipId]);
        expect(readLanes()).toEqual(gluedLanes);
    });

    // Red when a carried plan is not checked against the project at execution. The revision pin
    // already refuses a stale batch, so these drive the batch executor with the compiled
    // envelopes directly, which is where the handler alone stands between them and the project.
    it('refuses the command once its source clips moved after it compiled, leaving the project unchanged', async () => {
        const commands = readCompiledCommands(compileGlue());
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) => ({
                ...track,
                clips: track.clips.map((clip) => ({
                    ...clip,
                    startBeat: clip.startBeat + 4,
                    endBeat: clip.endBeat + 4,
                })),
            })),
        });
        flushAutomergeStorageWrites();
        const tracksBefore = structuredClone(trackStore.value!.tracks);
        const midiBefore = structuredClone(midiStore.value);
        const lanesBefore = structuredClone(automationStore.value?.lanes);

        const result = await executeCompiledCommands(commands);

        expect(result).toMatchObject({
            status: 'conflicted',
            reason: 'Action conflicts with current project state: glueClips: The glue this command recorded no longer matches the project',
        });
        expect(trackStore.value!.tracks).toEqual(tracksBefore);
        expect(midiStore.value).toEqual(midiBefore);
        expect(automationStore.value?.lanes).toEqual(lanesBefore);
    });

    it('refuses the command once a source clip was deleted after it compiled, leaving the project unchanged', async () => {
        const commands = readCompiledCommands(compileGlue());
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) => ({
                ...track,
                clips: track.clips.filter((clip) => clip.id !== 'clip-b'),
            })),
        });
        flushAutomergeStorageWrites();
        const tracksBefore = structuredClone(trackStore.value!.tracks);
        const midiBefore = structuredClone(midiStore.value);
        const lanesBefore = structuredClone(automationStore.value?.lanes);

        const result = await executeCompiledCommands(commands);

        expect(result).toMatchObject({
            status: 'conflicted',
            reason: 'Action conflicts with current project state: glueClips: The glue this command recorded no longer matches the project',
        });
        expect(trackStore.value!.tracks).toEqual(tracksBefore);
        expect(midiStore.value).toEqual(midiBefore);
        expect(automationStore.value?.lanes).toEqual(lanesBefore);
    });
});
