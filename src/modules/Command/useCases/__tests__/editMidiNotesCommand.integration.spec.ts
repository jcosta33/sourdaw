import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { addClip, createTrack, setArrangementEventBus, setTrackStoreState } from '#/modules/Arrangement/useCases';
import {
    captureProjectMutationAuthorization,
    captureProjectRevision,
    createCrdtDoc,
    getCrdtDoc,
    inspectAgentProjectDivergence,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    settledProjectRevisionMatchesLiveIgnoringSaveWrites,
} from '#/modules/CrdtDocument/useCases';
import { type EditMidiNotesPayload } from '#/modules/MIDI/events';
import { midiStore } from '#/modules/MIDI/stores';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { type AppAction } from '#/utils/handlerContract';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { undoStore } from '../../stores/undoStore';
import { setActionHistoryMetadataPort } from '../actionHistoryMetadataPort';
import { captureCommandTargetFingerprints } from '../captureCommandTargetFingerprints';
import { clearUndoHistory } from '../clearUndoHistory';
import { commandBatchPreflightPort } from '../commandBatchPreflightPort';
import { commandProjectDivergencePort } from '../commandProjectDivergencePort';
import { commandProjectRevisionPort } from '../commandProjectRevisionPort';
import { compileVersionedCommandBatchEnvelope } from '../compileVersionedCommandBatchEnvelope';
import { configureCommandBatchIdempotency } from '../configureCommandBatchIdempotency';
import { createExecutionCommandEnvelope } from '../createExecutionCommandEnvelope';
import { executeAppActionBatch } from '../executeAppActionBatch';
import { getExecutableCommandRegistration } from '../getExecutableCommandRegistration';
import { parseVersionedCommandEnvelope } from '../parseVersionedCommandEnvelope';
import { redo } from '../redo';
import { serializeVersionedCommandEnvelope } from '../serializeVersionedCommandEnvelope';
import { undo } from '../undo';

import { executeApprovedVersionedCommandBatchEnvelope } from './commandApprovalTestFixture';

const TRACK_ID = 'midi-phrase-track';
const CLIP_ID = 'midi-phrase-clip';
const OPENING = {
    id: 'opening',
    pitch: 60,
    startBeat: 0,
    duration: 1,
    velocity: 90,
    expression: { slide: [{ offsetBeats: 0.5, value: 44 }] },
};
const PHRASE = {
    id: 'phrase',
    pitch: 64,
    startBeat: 2,
    duration: 1,
    velocity: 91,
    channel: 3,
    articulation: 'accent',
    pitchBend: -100,
    pitchBendRangeSemitones: 24,
    expression: {
        pressure: [
            { offsetBeats: 0.25, value: 51 },
            { offsetBeats: 0.875, value: 77 },
        ],
    },
};
const FILLER = { id: 'filler', pitch: 67, startBeat: 3.5, duration: 0.25, velocity: 80 };
const TAIL = { id: 'tail', pitch: 69, startBeat: 6, duration: 1, velocity: 88, probability: 82 };
const MOTIF = [OPENING, PHRASE, FILLER, TAIL];
const CC = { id: 'sustain', channel: 3, controller: 64, beat: 1.25, value: 127 };
const BEND = { id: 'bend', channel: 3, beat: 1.5, value: -2048 };
const HISTORY_PORT = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function seedNotes(notes: EditMidiNotesPayload['guard']['expectedNotes'] | undefined): void {
    midiStore.set({
        probabilitySeed: 165,
        notesByClipId: notes ? { [CLIP_ID]: structuredClone([...notes]) } : {},
        ccByClipId: { [CLIP_ID]: [CC] },
        pitchBendByClipId: { [CLIP_ID]: [BEND] },
    });
    flushAutomergeStorageWrites();
}

function durableMidi() {
    return getCrdtDoc<{ midi?: NonNullable<typeof midiStore.value> }>('root')?.midi;
}

function clipNotes() {
    return durableMidi()?.notesByClipId[CLIP_ID];
}

function editAction(
    operations: EditMidiNotesPayload['operations'],
    expectedNotes: EditMidiNotesPayload['guard']['expectedNotes'] = MOTIF,
    present = true
): Extract<AppAction, { type: 'editMidiNotes' }> {
    return {
        type: 'editMidiNotes',
        payload: {
            clipId: CLIP_ID,
            operations,
            guard: {
                trackId: TRACK_ID,
                expectedNotes,
                expectedNotesBucketPresent: present,
                editWindow: { startBeat: 1.25, endBeat: 6 },
                scope: {
                    allowedNoteIds: expectedNotes
                        .filter((note) => note.id !== OPENING.id && note.id !== TAIL.id)
                        .map((note) => note.id),
                    protectedNoteIds: [OPENING.id, TAIL.id],
                    protectedWindows: [
                        { startBeat: 0, endBeat: 1.25 },
                        { startBeat: 6, endBeat: 8 },
                    ],
                    insertionWindows: [{ startBeat: 1.25, endBeat: 6 }],
                    insertionBudget: 2,
                },
            },
        },
    };
}

function compile(actions: readonly AppAction[]) {
    const baseRevision = captureProjectRevision();
    const groupId = crypto.randomUUID();
    const commands = actions.map((action) => {
        const { envelope } = createExecutionCommandEnvelope({
            action,
            expectedEffect: 'Edit the admitted MIDI phrase',
            normalizedProjectRevision: baseRevision,
            options: { groupId },
        });
        return envelope;
    });
    const compiled = compileVersionedCommandBatchEnvelope({
        runId: groupId,
        batchId: groupId,
        projectId: 'motif-project',
        baseRevision,
        intent: 'Change a pitch, remove a filler and insert a pickup',
        commands: commands.map(serializeVersionedCommandEnvelope),
    });
    return { ...compiled, commands };
}

function adoptBaseNotesAsTake() {
    const takeLaneState = {
        lanes: [
            {
                id: 'motif-takes',
                trackId: TRACK_ID,
                takes: [
                    {
                        id: 'motif-take',
                        clipId: CLIP_ID,
                        name: 'Take 1',
                        startBeat: 16,
                        endBeat: 24,
                        selected: true,
                    },
                ],
                activeCompRegions: [{ takeId: 'motif-take', startBeat: 16, endBeat: 24 }],
            },
        ],
    };
    takeLaneStore.set(takeLaneState);
    flushAutomergeStorageWrites();
    const readDurableTakeLanes = () => getCrdtDoc<{ takeLanes?: typeof takeLaneState }>('root')?.takeLanes;
    expect(readDurableTakeLanes()).toEqual(takeLaneState);
    return { takeLaneState, readDurableTakeLanes };
}

function expectAdoptedTakePreserved(
    take: ReturnType<typeof adoptBaseNotesAsTake>,
    expectedNotes: EditMidiNotesPayload['guard']['expectedNotes'],
    history: typeof undoStore.value
): void {
    expect(clipNotes()).toEqual(expectedNotes);
    expect(midiStore.value?.notesByClipId[CLIP_ID]).toEqual(expectedNotes);
    expect(take.readDurableTakeLanes()).toEqual(take.takeLaneState);
    expect(takeLaneStore.value).toEqual(take.takeLaneState);
    expect(undoStore.value).toEqual(history);
}

describe('selective MIDI command on Automerge project truth', () => {
    beforeEach(() => {
        Container.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('selective MIDI command integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getMidiNoteTransformHandlers());
        clearUndoHistory();
        setActionHistoryMetadataPort(HISTORY_PORT);
        setArrangementEventBus({ emit: () => Promise.resolve() });
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        commandProjectRevisionPort.configureMutationAuthority({
            revisionProvider: captureProjectRevision,
            captureMutationAuthorization: captureProjectMutationAuthorization,
        });
        commandProjectRevisionPort.setProvider(captureProjectRevision);
        commandProjectDivergencePort.setProvider(inspectAgentProjectDivergence);
        vi.stubGlobal('navigator', {
            ...navigator,
            locks: { request: (_name: string, _options: LockOptions, task: () => unknown) => Promise.resolve(task()) },
        });
        configureCommandBatchIdempotency({ canExecute: () => true });
        commandProjectRevisionPort.setLiveMatchIgnoringSaveWrites(settledProjectRevisionMatchesLiveIgnoringSaveWrites);
        commandBatchPreflightPort.setProvider(({ projectDocument, targetIds }) => {
            const targetFingerprints = captureCommandTargetFingerprints({
                document: projectDocument ?? getCrdtDoc('root'),
                targetIds,
            });
            return {
                audioGraphValid: true,
                availableAssetHashes: [],
                availableAudioBufferIds: [],
                lockedRanges: [],
                projectId: 'motif-project',
                projectInvariantsValid: true,
                targetFingerprints,
            };
        });

        setTrackStoreState({
            ...defaultTrackState,
            tracks: [createTrack({ id: TRACK_ID, kind: 'midi', name: 'Electric piano' })],
        });
        expect(
            addClip({ id: CLIP_ID, trackId: TRACK_ID, startBeat: 16, endBeat: 24, name: 'Main motif', type: 'midi' })
        ).not.toBeNull();
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        seedNotes(MOTIF);
    });

    afterEach(() => {
        clearUndoHistory();
        clearHandlerRegistry();
        localStorage.removeItem('sourdaw:command-batch-idempotency:v1');
        vi.unstubAllGlobals();
        commandProjectRevisionPort.setProvider(null);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        Container.clear();
    });

    it('commits the exact recorded operations, leaves the other notes and sound intact, and round-trips one undo', async () => {
        const before = structuredClone(trackStore.value);
        const batch = compile([
            editAction([
                {
                    type: 'patch',
                    noteId: PHRASE.id,
                    patch: { pitch: 63, startBeat: 2.25, duration: 0.75, velocity: 96 },
                },
                { type: 'delete', noteId: FILLER.id },
                { type: 'insert', note: { pitch: 58, startBeat: 1.5, duration: 0.25, velocity: 87 } },
            ]),
        ]);
        expect(batch.authority.grants).toMatchObject({ create: true, delete: true });
        expect(batch.authority.budgets.maxDeletedObjects).toBe(1);
        const command = batch.commands[0]!;
        const assigned = command.applicationAssignedIds[0]!;
        expect(command.applicationAssignedIds).toEqual([
            { argument: 'operations[2].note.id', value: expect.stringMatching(/^note-command-/) },
        ]);
        expect(
            parseVersionedCommandEnvelope(serializeVersionedCommandEnvelope({ ...command, applicationAssignedIds: [] }))
        ).toMatchObject({ status: 'invalid' });
        const result = await executeApprovedVersionedCommandBatchEnvelope({ ...batch, confirmed: true });
        expect(result).toMatchObject({
            status: 'committed',
            actions: [
                {
                    action: { type: 'editMidiNotes', payload: command.arguments },
                    label: 'Edit MIDI notes (1 updated, 1 removed, 1 inserted)',
                },
            ],
            receipt: {
                outcome: 'committed',
                semanticDiff: { destructiveChanges: [{ classification: 'deletion', recovery: 'inverse' }] },
                commandOutcomes: [
                    {
                        operation: 'editMidiNotes',
                        outcome: 'committed',
                        affectedIds: [CLIP_ID, FILLER.id, assigned.value, PHRASE.id].toSorted(),
                        compensationAvailable: true,
                    },
                ],
            },
        });
        const edited = [
            OPENING,
            {
                ...PHRASE,
                pitch: 63,
                startBeat: 2.25,
                duration: 0.75,
                velocity: 96,
                expression: { pressure: [{ offsetBeats: 0.25, value: 51 }] },
            },
            TAIL,
            { id: assigned.value, pitch: 58, startBeat: 1.5, duration: 0.25, velocity: 87, probability: 100 },
        ];
        expect(clipNotes()).toEqual(edited);
        expect(midiStore.value?.notesByClipId[CLIP_ID]).toEqual(edited);
        expect(durableMidi()?.ccByClipId[CLIP_ID]).toEqual([CC]);
        expect(durableMidi()?.pitchBendByClipId[CLIP_ID]).toEqual([BEND]);
        expect(trackStore.value).toEqual(before);
        const retry = await executeApprovedVersionedCommandBatchEnvelope({ ...batch, confirmed: true });
        expect(retry).toMatchObject({ status: 'idempotent-replay', actions: [] });
        expect('receipt' in retry && retry.receipt).toEqual('receipt' in result && result.receipt);
        expect(clipNotes()).toEqual(edited);
        expect(undoStore.value?.past).toHaveLength(1);
        const history = undoStore.value?.past[0];
        expect(history?.kind).toBe('action');
        if (history?.kind !== 'action') {
            throw new Error('Expected an action history entry');
        }
        expect(getExecutableCommandRegistration('editMidiNotes').sessionEntryValidator?.(history)).toBe(true);
        expect(
            getExecutableCommandRegistration('editMidiNotes').sessionEntryValidator?.({
                ...history,
                redoAction: history.inverseAction ?? undefined,
            })
        ).toBe(false);
        await undo();
        expect(clipNotes()).toEqual(MOTIF);
        expect(undoStore.value?.past).toHaveLength(0);
        await redo();
        expect(clipNotes()).toEqual(edited);
        expect(trackStore.value).toEqual(before);
    });

    it('refuses selective undo after a take adopts the base notes', async () => {
        const edit = editAction([{ type: 'patch', noteId: PHRASE.id, patch: { pitch: 63 } }]);
        expect(await executeAppActionBatch([edit])).toMatchObject({ status: 'committed' });
        const edited = [OPENING, { ...PHRASE, pitch: 63 }, FILLER, TAIL];
        expect(clipNotes()).toEqual(edited);

        const take = adoptBaseNotesAsTake();
        const history = structuredClone(undoStore.value);
        expect(history).toMatchObject({ past: [expect.any(Object)], future: [] });

        await expect(undo()).resolves.toEqual({ headConsumed: false });
        expectAdoptedTakePreserved(take, edited, history);
    });

    it('refuses selective redo after a take adopts the base notes', async () => {
        const edit = editAction([{ type: 'patch', noteId: PHRASE.id, patch: { pitch: 63 } }]);
        expect(await executeAppActionBatch([edit])).toMatchObject({ status: 'committed' });
        expect(clipNotes()).toEqual([OPENING, { ...PHRASE, pitch: 63 }, FILLER, TAIL]);
        await expect(undo()).resolves.toEqual({ headConsumed: true });
        expect(clipNotes()).toEqual(MOTIF);

        const take = adoptBaseNotesAsTake();
        const history = structuredClone(undoStore.value);
        expect(history).toMatchObject({ past: [], future: [expect.any(Object)] });

        await redo();
        expectAdoptedTakePreserved(take, MOTIF, history);
    });

    it('takes its exact before-image from ordered add, edit and restore predecessors', async () => {
        const added = { id: 'new-prior', pitch: 67, startBeat: 4.5, duration: 1, velocity: 75, probability: 100 };
        const add: AppAction = { type: 'addNotes', payload: { clipId: CLIP_ID, notes: [added] } };
        const first = editAction([{ type: 'patch', noteId: added.id, patch: { velocity: 100 } }], [...MOTIF, added]);
        const amended = [...MOTIF, { ...added, velocity: 100 }];
        const second = editAction([{ type: 'delete', noteId: FILLER.id }], amended);
        const tailInsert: AppAction = {
            type: 'addNotes',
            payload: { clipId: CLIP_ID, notes: [{ id: 'new-after', pitch: 61, startBeat: 7, duration: 0.25 }] },
        };
        const result = await executeAppActionBatch([add, first, second, tailInsert], {
            groupId: 'edit-motif-sequence',
        });
        expect(result).toMatchObject({
            status: 'committed',
            actions: [
                { action: { type: 'addNotes' } },
                { action: first },
                { action: second },
                { action: { type: 'addNotes' } },
            ],
        });
        const edited = clipNotes();
        expect(edited).toEqual([
            ...amended.filter((note) => note.id !== FILLER.id),
            expect.objectContaining({ id: 'new-after', pitch: 61 }),
        ]);
        await undo();
        expect(clipNotes()).toEqual(MOTIF);
        await redo();
        expect(clipNotes()).toEqual(edited);
    });

    it('validates a forward edit against an earlier guarded restore of a missing notes bucket', async () => {
        seedNotes(undefined);
        const replay: AppAction = {
            type: 'restoreMidiClipNotes',
            payload: {
                clipId: CLIP_ID,
                notes: MOTIF,
                expectedNotes: [],
                notesBucketPresent: true,
                expectedNotesBucketPresent: false,
                noteTransformReplayGuard: { trackId: TRACK_ID, expectedTrackFrozen: false, expectedClipLocked: false },
            },
        };
        const edit = editAction([{ type: 'patch', noteId: PHRASE.id, patch: { pitch: 63 } }]);
        expect(await executeAppActionBatch([replay, edit], { groupId: 'restore-and-edit' })).toMatchObject({
            status: 'committed',
        });
        expect(clipNotes()).toEqual([OPENING, { ...PHRASE, pitch: 63 }, FILLER, TAIL]);
        await undo();
        expect(clipNotes()).toEqual(MOTIF);
    });

    it.each([false, true])('round-trips a notes bucket with initial presence %s', async (present) => {
        seedNotes(present ? [] : undefined);
        const payload = editAction([{ type: 'insert', note: { pitch: 65, startBeat: 2, duration: 1 } }], [], present);
        const wrongPresence = {
            ...payload,
            payload: { ...payload.payload, guard: { ...payload.payload.guard, expectedNotesBucketPresent: !present } },
        };
        expect(await executeAppActionBatch([wrongPresence])).toMatchObject({ status: 'conflicted', actions: [] });
        expect(clipNotes()).toEqual(present ? [] : undefined);
        expect(await executeAppActionBatch([payload])).toMatchObject({ status: 'committed' });
        const edited = clipNotes();
        expect(edited).toEqual([expect.objectContaining({ pitch: 65 })]);
        await undo();
        expect(clipNotes()).toEqual(present ? [] : undefined);
        await redo();
        expect(clipNotes()).toEqual(edited);
    });

    it('derives separate authority for patches, insertions and deletions and rejects a stale approved batch', async () => {
        const patch = editAction([{ type: 'patch', noteId: PHRASE.id, patch: { pitch: 63 } }]);
        const batch = compile([patch]);
        expect(batch.authority.grants).toMatchObject({ create: false, delete: false });
        expect(batch.authority.budgets.maxDeletedObjects).toBe(0);
        expect(compile([editAction([{ type: 'delete', noteId: FILLER.id }])]).authority.grants).toMatchObject({
            create: false,
            delete: true,
        });
        expect(
            compile([editAction([{ type: 'insert', note: { pitch: 61, startBeat: 3, duration: 0.25 } }])]).authority
                .grants
        ).toMatchObject({
            create: true,
            delete: false,
        });

        const changed = [OPENING, { ...PHRASE, velocity: 92 }, FILLER, TAIL];
        seedNotes(changed);
        const result = await executeApprovedVersionedCommandBatchEnvelope({ ...batch, confirmed: true });
        expect(result, 'reason' in result ? result.reason : undefined).toMatchObject({
            status: 'conflicted',
            actions: [],
        });
        expect(clipNotes()).toEqual(changed);
        expect(undoStore.value?.past).toHaveLength(0);
    });

    it.each(['frozen', 'locked', 'ambiguous', 'missing'] as const)('refuses a %s clip owner', async (state) => {
        const trackState = trackStore.value!;
        const track = trackState.tracks.find(({ id }) => id === TRACK_ID)!;
        const target = track.clips.find(({ id }) => id === CLIP_ID)!;
        switch (state) {
            case 'frozen':
                setTrackStoreState({ ...trackState, tracks: [{ ...track, frozen: true }] });
                break;
            case 'locked':
                setTrackStoreState({ ...trackState, tracks: [{ ...track, clips: [{ ...target, locked: true }] }] });
                break;
            case 'ambiguous':
                setTrackStoreState({ ...trackState, tracks: [track, { ...track, id: 'second-owner' }] });
                break;
            case 'missing':
                setTrackStoreState({ ...trackState, tracks: [{ ...track, clips: [] }] });
                break;
        }
        const edit = editAction([{ type: 'patch', noteId: PHRASE.id, patch: { pitch: 63 } }]);
        expect(await executeAppActionBatch([edit])).toMatchObject({ status: 'conflicted', actions: [] });
        expect(clipNotes()).toEqual(MOTIF);
    });

    it('refuses a protected note and a note moved past the limit by its duration', async () => {
        const protectedEdit = editAction([{ type: 'patch', noteId: OPENING.id, patch: { pitch: 61 } }]);
        const unboundedMove = editAction([{ type: 'patch', noteId: PHRASE.id, patch: { startBeat: 5.5 } }]);
        const registration = getExecutableCommandRegistration('editMidiNotes');
        expect(registration.materializedArgumentsValidator?.(protectedEdit.payload)).toBe(false);
        expect(registration.materializedArgumentsValidator?.(unboundedMove.payload)).toBe(false);
        expect(await executeAppActionBatch([unboundedMove])).toMatchObject({ status: 'conflicted', actions: [] });
        expect(clipNotes()).toEqual(MOTIF);
    });

    it('refuses a stale before-image and an unprojected same-clip writer atomically', async () => {
        const stale = editAction(
            [{ type: 'patch', noteId: PHRASE.id, patch: { pitch: 63 } }],
            [OPENING, { ...PHRASE, velocity: 10 }, FILLER, TAIL]
        );
        expect(await executeAppActionBatch([stale])).toMatchObject({ status: 'conflicted', actions: [] });
        const edit = editAction([{ type: 'patch', noteId: PHRASE.id, patch: { pitch: 63 } }]);
        // This capped transform is batch-capable and has no overlaps to shorten in this fixture.
        // If the prefix silently ignores it, the exact snapshot still matches at execution and the edit commits.
        const unprojectedWrite: AppAction = {
            type: 'removeShortMidiOverlaps',
            payload: {
                clipId: CLIP_ID,
                maximumOverlapMs: 50,
                expectedTempo: 120,
                expectedTrackId: TRACK_ID,
                trackName: 'Electric piano',
                clipName: 'Main motif',
                expectedTrackFrozen: false,
                expectedClipLocked: false,
                expectedNotes: MOTIF,
            },
        };
        expect(await executeAppActionBatch([unprojectedWrite, edit])).toMatchObject({
            status: 'conflicted',
            reason: expect.stringContaining('editMidiNotes: The MIDI edit disagrees'),
            actions: [],
        });
        expect(clipNotes()).toEqual(MOTIF);
        expect(undoStore.value?.past).toHaveLength(0);
    });
});
