import { getHeads } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { type Clip } from '#/modules/Arrangement/stores';
import {
    createTrack,
    getArrangementHandlers,
    setArrangementEventBus,
    setTrackStoreState,
} from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, executeAppActionBatch } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { setMidiStoreState } from '#/modules/MIDI/useCases';
import { type AppAction, type MidiClipNoteSnapshot } from '#/utils/handlerContract';

import { handleAddNotes } from '../../noteCrud/handleAddNotes';
import { handleCopyMidiArticulations } from '../handleCopyMidiArticulations';
import { handleRestoreMidiClipNotes } from '../handleRestoreMidiClipNotes';

type CopyMidiArticulationsAction = Extract<AppAction, { type: 'copyMidiArticulations' }>;
type RestoreMidiClipNotesAction = Extract<AppAction, { type: 'restoreMidiClipNotes' }>;

const sourceClipId = 'source-clip';
const targetClipId = 'target-clip';
const trackId = 'track-midi';

function midiClip(id: string): Clip {
    return {
        id,
        trackId,
        name: id,
        startBeat: 0,
        endBeat: 4,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#7c3aed',
        locked: false,
        muted: false,
    };
}

function sourceNote(articulation = 'staccato'): MidiClipNoteSnapshot {
    return {
        id: 'source-note',
        pitch: 60,
        startBeat: 0,
        duration: 1,
        velocity: 96,
        articulation,
    };
}

function targetNote(articulation = 'legato'): MidiClipNoteSnapshot {
    return {
        id: 'target-note',
        pitch: 67,
        startBeat: 1,
        duration: 0.5,
        velocity: 72,
        probability: 88,
        pressure: 0.35,
        slide: 0.2,
        pitchBend: -128,
        pitchBendRangeSemitones: 12,
        channel: 3,
        articulation,
    };
}

function targetNoteAfterCopy(): MidiClipNoteSnapshot {
    return {
        ...targetNote(),
        articulation: 'staccato',
    };
}

function requireRestoreAction(action: AppAction | null | undefined): RestoreMidiClipNotesAction {
    if (action?.type !== 'restoreMidiClipNotes') {
        throw new Error('Expected restoreMidiClipNotes action');
    }
    return action;
}

function requireCanReapplyAfterDivergence(): NonNullable<typeof handleRestoreMidiClipNotes.canReapplyAfterDivergence> {
    const canReapplyAfterDivergence = handleRestoreMidiClipNotes.canReapplyAfterDivergence;
    if (canReapplyAfterDivergence === undefined) {
        throw new Error('Expected restore replay guard');
    }
    return canReapplyAfterDivergence;
}

function requireValidate(): NonNullable<typeof handleRestoreMidiClipNotes.validate> {
    const validate = handleRestoreMidiClipNotes.validate;
    if (validate === undefined) {
        throw new Error('Expected restore validator');
    }
    return validate;
}

function arrangeCopyFixture(): CopyMidiArticulationsAction {
    const track = createTrack({
        id: trackId,
        initialAlternativeId: 'track-midi-alt',
        initialDeviceId: 'track-midi-synth',
        kind: 'midi',
        name: 'MIDI',
    });
    setTrackStoreState({
        tracks: [{ ...track, clips: [midiClip(sourceClipId), midiClip(targetClipId)] }],
        selectedTrackId: trackId,
        ghostClips: [],
    });
    setMidiStoreState({
        notesByClipId: {
            [sourceClipId]: [sourceNote()],
            [targetClipId]: [targetNote()],
        },
        ccByClipId: {},
        pitchBendByClipId: {},
    });
    return {
        type: 'copyMidiArticulations',
        payload: {
            trackId,
            sourceClipId,
            targetClipId,
            notePairs: [{ sourceNoteId: 'source-note', targetNoteId: 'target-note' }],
            expectedSourceNotes: [sourceNote()],
            expectedTargetNotes: [targetNote()],
            expectedTrackFrozen: false,
            expectedSourceClipLocked: false,
            expectedTargetClipLocked: false,
        },
    };
}

function registerArticulationHandlers(): void {
    registerHandlerMap({
        copyMidiArticulations: handleCopyMidiArticulations,
        restoreMidiClipNotes: handleRestoreMidiClipNotes,
    });
}

beforeEach(() => {
    configureAutomergeStoragePort(null);
});

afterEach(() => {
    setTrackStoreState({ tracks: [], selectedTrackId: null, ghostClips: [] });
    setMidiStoreState({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    flushAutomergeStorageWrites();
    configureAutomergeStoragePort(null);
    clearHandlerRegistry();
});

describe('handleRestoreMidiClipNotes', () => {
    it('rejects an out-of-duration curve before replay writes, including a nested source guard', () => {
        arrangeCopyFixture();
        const invalid = {
            ...targetNote(),
            expression: { pressure: [{ offsetBeats: 1, value: 90 }] },
        };
        const action: RestoreMidiClipNotesAction = {
            type: 'restoreMidiClipNotes',
            payload: { clipId: targetClipId, expectedNotes: [targetNote()], notes: [invalid] },
        };
        const before = structuredClone(midiStore.value);

        expect(handleRestoreMidiClipNotes.validateSessionActionArguments?.(action.payload)).toBe(false);
        expect(requireValidate()(action, { actions: [action], actionIndex: 0 })).toBe(false);
        expect(handleRestoreMidiClipNotes.execute(action)).toEqual({ status: 'conflict' });
        expect(midiStore.value).toEqual(before);

        const guarded: RestoreMidiClipNotesAction = {
            ...action,
            payload: {
                ...action.payload,
                notes: [targetNote()],
                articulationReplayGuard: {
                    trackId,
                    sourceClipId,
                    expectedSourceNotes: [
                        { ...sourceNote(), expression: { pressure: [{ offsetBeats: 1, value: 90 }] } },
                    ],
                    expectedTrackFrozen: false,
                    expectedSourceClipLocked: false,
                    expectedTargetClipLocked: false,
                },
            },
        };
        expect(handleRestoreMidiClipNotes.validateSessionActionArguments?.(guarded.payload)).toBe(false);
        expect(requireValidate()(guarded, { actions: [guarded], actionIndex: 0 })).toBe(false);
        expect(handleRestoreMidiClipNotes.execute(guarded)).toEqual({ status: 'conflict' });
        expect(midiStore.value).toEqual(before);
    });

    it('refuses an invalid expression through a fresh command without advancing document or undo', async () => {
        resetCrdtProjectAuthority('restore MIDI note admission');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        arrangeCopyFixture();
        registerHandlerMap({ restoreMidiClipNotes: handleRestoreMidiClipNotes });
        clearUndoHistory();
        flushAutomergeStorageWrites();
        const invalid: RestoreMidiClipNotesAction = {
            type: 'restoreMidiClipNotes',
            payload: {
                clipId: targetClipId,
                expectedNotes: [targetNote()],
                notes: [{ ...targetNote(), expression: { pressure: [{ offsetBeats: 1, value: 90 }] } }],
            },
        };
        const document = getCrdtDoc('root');
        if (!document) {
            throw new Error('Expected CRDT document');
        }
        const heads = getHeads(document);
        const before = structuredClone(midiStore.value);
        const past = undoStore.value?.past.length;

        await expect(executeAppAction(invalid)).rejects.toThrow();
        flushAutomergeStorageWrites();
        expect(midiStore.value).toEqual(before);
        expect(getHeads(getCrdtDoc('root')!)).toEqual(heads);
        expect(undoStore.value?.past.length).toBe(past);
        removeCrdtDoc('root');
    });

    it('owns validated handler restore curves through the document flush', async () => {
        resetCrdtProjectAuthority('restore MIDI curve ownership');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        arrangeCopyFixture();
        registerHandlerMap({ restoreMidiClipNotes: handleRestoreMidiClipNotes });
        clearUndoHistory();
        flushAutomergeStorageWrites();
        const restored = {
            ...targetNote(),
            expression: {
                pressure: [{ offsetBeats: 0.25, value: 90 }],
                slide: [{ offsetBeats: 0.25, value: 40 }],
                pitchBend: [{ offsetBeats: 0.25, value: 20 }],
            },
        };
        const action: RestoreMidiClipNotesAction = {
            type: 'restoreMidiClipNotes',
            payload: { clipId: targetClipId, expectedNotes: [targetNote()], notes: [restored] },
        };
        expect(handleRestoreMidiClipNotes.validateSessionActionArguments?.(action.payload)).toBe(true);
        expect(requireValidate()(action, { actions: [action], actionIndex: 0 })).toBe(true);
        expect(handleRestoreMidiClipNotes.execute(action)).toEqual({ status: 'written' });
        expect(midiStoreSnapshot(targetClipId)?.[0]?.expression).toEqual(restored.expression);
        for (const dimension of ['pressure', 'slide', 'pitchBend'] as const) {
            restored.expression[dimension][0]!.offsetBeats = 0.5;
            restored.expression[dimension].push({ offsetBeats: 0.5, value: 1 });
            restored.expression[dimension] = [{ offsetBeats: 0.4, value: 1 }];
        }
        flushAutomergeStorageWrites();
        const document = getCrdtDoc<{ midi?: { notesByClipId: Record<string, MidiClipNoteSnapshot[]> } }>('root');
        const expected = {
            pressure: [{ offsetBeats: 0.25, value: 90 }],
            slide: [{ offsetBeats: 0.25, value: 40 }],
            pitchBend: [{ offsetBeats: 0.25, value: 20 }],
        };
        expect(document?.midi?.notesByClipId[targetClipId]?.[0]?.expression).toEqual(expected);
        expect(midiStoreSnapshot(targetClipId)?.[0]?.expression).toEqual(expected);
        removeCrdtDoc('root');
    });

    it('admits copyMidiArticulations into an atomic compensated batch when the restore guard matches live state', async () => {
        const action = arrangeCopyFixture();
        registerArticulationHandlers();

        const result = await executeAppActionBatch([action], {
            groupId: 'batch-articulations',
            groupLabel: 'Copy MIDI articulations',
            requireCompensation: true,
            source: 'prompt',
        });

        expect(result.status).toBe('committed');
        expect(result.actions.map((executed) => executed.action.type)).toEqual(['copyMidiArticulations']);
        expect(handleRestoreMidiClipNotes.requiresAbortCompensation).toBe(false);
        expect(handleRestoreMidiClipNotes.batchRestriction).toBeUndefined();
        expect(handleRestoreMidiClipNotes.validate).toBeDefined();
        expect(handleRestoreMidiClipNotes.canReapplyAfterDivergence).toBeDefined();
        expect(midiStoreSnapshot(targetClipId)).toEqual([targetNoteAfterCopy()]);
    });

    it('uses the articulation replay guard as a live state predicate for inverse restore', () => {
        const action = arrangeCopyFixture();
        const inverse = requireRestoreAction(handleCopyMidiArticulations.describe(action).inverseAction);

        expect(handleCopyMidiArticulations.execute(action)).toEqual({ status: 'written' });
        expect(midiStoreSnapshot(targetClipId)).toEqual([targetNoteAfterCopy()]);

        const canReapplyAfterDivergence = requireCanReapplyAfterDivergence();
        const validate = requireValidate();
        expect(canReapplyAfterDivergence(inverse)).toBe(true);
        expect(handleRestoreMidiClipNotes.execute(inverse)).toEqual({ status: 'written' });
        expect(midiStoreSnapshot(targetClipId)).toEqual([targetNote()]);

        setMidiStoreState({
            notesByClipId: {
                [sourceClipId]: [sourceNote('accent')],
                [targetClipId]: [targetNoteAfterCopy()],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });

        expect(canReapplyAfterDivergence(inverse)).toBe(false);
        expect(validate(inverse, { actions: [inverse], actionIndex: 0 })).toBe(false);
    });

    it('admits addNotes compensation against the projected post-forward notes on an existing clip', async () => {
        arrangeCopyFixture();
        registerHandlerMap({ addNotes: handleAddNotes, restoreMidiClipNotes: handleRestoreMidiClipNotes });

        const result = await executeAppActionBatch(
            [
                {
                    type: 'addNotes',
                    payload: {
                        clipId: targetClipId,
                        notes: [{ id: 'added-note', pitch: 72, startBeat: 2, duration: 1, velocity: 100 }],
                    },
                },
            ],
            { groupId: 'batch-add-notes-existing', requireCompensation: true }
        );

        expect(result.status).toBe('committed');
        expect(midiStoreSnapshot(targetClipId)?.map((note) => note.id)).toEqual(['target-note', 'added-note']);
    });

    it('admits addNotes compensation after batch-local MIDI track and clip creation', async () => {
        setTrackStoreState({ tracks: [], selectedTrackId: null, ghostClips: [] });
        setMidiStoreState({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        setArrangementEventBus({ emit: async () => undefined });
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap({ addNotes: handleAddNotes, restoreMidiClipNotes: handleRestoreMidiClipNotes });

        const result = await executeAppActionBatch(
            [
                {
                    type: 'addTrack',
                    payload: {
                        id: 'track-created',
                        kind: 'midi',
                        name: 'Created MIDI',
                        withoutDefaultDevice: true,
                    },
                },
                {
                    type: 'addClip',
                    payload: {
                        id: 'clip-created',
                        trackId: 'track-created',
                        startBeat: 0,
                        endBeat: 4,
                        name: 'Created clip',
                        type: 'midi',
                    },
                },
                {
                    type: 'addNotes',
                    payload: {
                        clipId: 'clip-created',
                        notes: [{ id: 'created-note', pitch: 60, startBeat: 0, duration: 1, velocity: 96 }],
                    },
                },
            ],
            { groupId: 'batch-add-notes-created', requireCompensation: true }
        );

        expect(result.status).toBe('committed');
        expect(midiStoreSnapshot('clip-created')?.map((note) => note.id)).toEqual(['created-note']);
    });
});

function midiStoreSnapshot(clipId: string): readonly MidiClipNoteSnapshot[] | undefined {
    const state = midiStore.getSnapshot();
    return state?.notesByClipId[clipId];
}
