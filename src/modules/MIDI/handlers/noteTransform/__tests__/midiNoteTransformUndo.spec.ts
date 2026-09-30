import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { addClip, createTrack, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, executeAppActionBatch, redo, undo } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { type MidiNote } from '../../../models/MidiNote';
import { midiStore } from '../../../stores/midiStore';
import { getMidiNoteTransformHandlers } from '../../../useCases/getMidiNoteTransformHandlers';
import { handleInvertNotes } from '../handleInvertNotes';
import { handleQuantizeNoteLengths } from '../handleQuantizeNoteLengths';
import { handleQuantizeNotes } from '../handleQuantizeNotes';
import { handleRestoreMidiClipNotes } from '../handleRestoreMidiClipNotes';
import { handleRetrogradeNotes } from '../handleRetrogradeNotes';
import { handleScaleAllVelocities } from '../handleScaleAllVelocities';
import { handleSetAllVelocities } from '../handleSetAllVelocities';
import { handleTransposeNotes } from '../handleTransposeNotes';

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

let notifications: NotifyPayload[] = [];
let unsubscribeFromNotifications: () => void = () => undefined;

const CLIP_ID = 'clip-1';
const TRACK_ID = 'track-1';

function note(id: string, pitch: number, startBeat: number, overrides: Partial<MidiNote> = {}): MidiNote {
    return {
        id,
        pitch,
        startBeat,
        duration: 0.375,
        velocity: 93,
        probability: 81,
        pressure: 0.45,
        slide: -0.1,
        pitchBend: 1_024,
        pitchBendRangeSemitones: 12,
        channel: 3,
        ...overrides,
    };
}

function atomicNote(id: 'a' | 'b', pitch: number, startBeat: number, overrides: Partial<MidiNote> = {}): MidiNote {
    return note(id, pitch, startBeat, {
        duration: id === 'a' ? 0.5 : 0.75,
        velocity: id === 'a' ? 80 : 101,
        ...overrides,
    });
}

function seedNotes(notes: MidiNote[]): MidiNote[] {
    const snapshot = notes.map((candidate) => ({ ...candidate }));
    midiStore.set({
        notesByClipId: { [CLIP_ID]: snapshot.map((candidate) => ({ ...candidate })) },
        ccByClipId: {},
        pitchBendByClipId: {},
    });
    return snapshot;
}

function resetMidiClipTopology(): void {
    setTrackStoreState({
        ...defaultTrackState,
        tracks: [createTrack({ id: TRACK_ID, kind: 'midi', name: 'MIDI' })],
    });
    if (
        addClip({
            id: CLIP_ID,
            trackId: TRACK_ID,
            startBeat: 0,
            endBeat: 4,
            name: 'MIDI clip',
            type: 'midi',
        }) === null
    ) {
        throw new Error('Expected MIDI clip fixture');
    }
}

type InvalidMidiTarget = 'missing' | 'wrong-kind' | 'frozen' | 'locked' | 'ambiguous';

function setInvalidMidiTarget(invalidTarget: InvalidMidiTarget): void {
    const track = trackStore.value!.tracks[0]!;
    const clip = track.clips[0]!;
    if (invalidTarget === 'missing') {
        setTrackStoreState({ ...defaultTrackState, tracks: [] });
        return;
    }
    if (invalidTarget === 'wrong-kind') {
        setTrackStoreState({
            ...defaultTrackState,
            tracks: [{ ...track, clips: [{ ...clip, type: 'audio' }] }],
        });
        return;
    }
    if (invalidTarget === 'frozen') {
        setTrackStoreState({ ...defaultTrackState, tracks: [{ ...track, frozen: true }] });
        return;
    }
    if (invalidTarget === 'locked') {
        setTrackStoreState({
            ...defaultTrackState,
            tracks: [{ ...track, clips: [{ ...clip, locked: true }] }],
        });
        return;
    }
    const duplicateTrack = createTrack({ id: 'track-duplicate', kind: 'midi', name: 'Duplicate MIDI' });
    setTrackStoreState({
        ...defaultTrackState,
        tracks: [track, { ...duplicateTrack, clips: [{ ...clip, trackId: duplicateTrack.id }] }],
    });
}

function currentNotes(): MidiNote[] {
    return midiStore.value?.notesByClipId[CLIP_ID] ?? [];
}

function requireRestoreAction(
    action: AppAction | null | undefined
): Extract<AppAction, { type: 'restoreMidiClipNotes' }> {
    if (action?.type !== 'restoreMidiClipNotes') {
        throw new Error('Expected restoreMidiClipNotes inverse');
    }
    return action;
}

describe('MIDI note transform handlers', () => {
    beforeEach(() => {
        resetMidiClipTopology();
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    });

    it('quantize captures complete state, restores it exactly, and redoes deterministically', () => {
        const before = seedNotes([note('a', 60, 0.11), note('b', 64, 0.3)]);
        const action = {
            type: 'quantizeNotes' as const,
            payload: { clipId: CLIP_ID, gridSize: 0.25, strength: 0.5, swing: 0.1 },
        };
        const providerAction = structuredClone(action);

        const description = handleQuantizeNotes.describe(action);
        const inverse = requireRestoreAction(description.inverseAction);
        const replay = requireRestoreAction(description.redoAction);

        expect(handleQuantizeNotes.execute(action)).toEqual({ status: 'written' });
        const expectedPostState = currentNotes().map((candidate) => ({ ...candidate }));
        expect(inverse.payload.expectedNotes).toEqual(expectedPostState);
        expect(inverse.payload.notes).toEqual(before);
        expect(replay.payload.expectedNotes).toEqual(before);
        expect(replay.payload.notes).toEqual(expectedPostState);

        expect(handleRestoreMidiClipNotes.execute(inverse)).toEqual({ status: 'written' });
        expect(currentNotes()).toEqual(before);

        expect(handleQuantizeNotes.execute(action)).toEqual({ status: 'written' });
        expect(currentNotes()).toEqual(expectedPostState);
        expect(action).toEqual(providerAction);
        expect(action.payload).not.toHaveProperty('notes');
        expect(action.payload).not.toHaveProperty('expectedNotes');
    });

    it('transpose restores clamped pitches exactly and redoes deterministically', () => {
        const before = seedNotes([note('low', 3, 0), note('high', 125, 0.5)]);
        const action = { type: 'transposeNotes' as const, payload: { clipId: CLIP_ID, semitones: 8 } };
        const providerAction = structuredClone(action);

        const description = handleTransposeNotes.describe(action);
        const inverse = requireRestoreAction(description.inverseAction);

        expect(handleTransposeNotes.execute(action)).toEqual({ status: 'written' });
        const expectedPostState = currentNotes().map((candidate) => ({ ...candidate }));
        expect(expectedPostState.map((candidate) => candidate.pitch)).toEqual([11, 127]);
        expect(inverse.payload.expectedNotes).toEqual(expectedPostState);

        expect(handleRestoreMidiClipNotes.execute(inverse)).toEqual({ status: 'written' });
        expect(currentNotes()).toEqual(before);

        expect(handleTransposeNotes.execute(action)).toEqual({ status: 'written' });
        expect(currentNotes()).toEqual(expectedPostState);
        expect(action).toEqual(providerAction);
    });

    it('gives every deterministic whole-clip transform exact snapshot undo and redo', () => {
        const transforms = [
            {
                label: 'Invert notes',
                describe: () => handleInvertNotes.describe({ type: 'invertNotes', payload: { clipId: CLIP_ID } }),
                execute: () => handleInvertNotes.execute({ type: 'invertNotes', payload: { clipId: CLIP_ID } }),
            },
            {
                label: 'Retrograde notes',
                describe: () =>
                    handleRetrogradeNotes.describe({ type: 'retrogradeNotes', payload: { clipId: CLIP_ID } }),
                execute: () => handleRetrogradeNotes.execute({ type: 'retrogradeNotes', payload: { clipId: CLIP_ID } }),
            },
            {
                label: 'Quantize note lengths',
                describe: () =>
                    handleQuantizeNoteLengths.describe({
                        type: 'quantizeNoteLengths',
                        payload: { clipId: CLIP_ID, gridSize: 0.25 },
                    }),
                execute: () =>
                    handleQuantizeNoteLengths.execute({
                        type: 'quantizeNoteLengths',
                        payload: { clipId: CLIP_ID, gridSize: 0.25 },
                    }),
            },
            {
                label: 'Scale velocities ×0.5',
                describe: () =>
                    handleScaleAllVelocities.describe({
                        type: 'scaleAllVelocities',
                        payload: { clipId: CLIP_ID, factor: 0.5 },
                    }),
                execute: () =>
                    handleScaleAllVelocities.execute({
                        type: 'scaleAllVelocities',
                        payload: { clipId: CLIP_ID, factor: 0.5 },
                    }),
            },
            {
                label: 'Set all velocities to 64',
                describe: () =>
                    handleSetAllVelocities.describe({
                        type: 'setAllVelocities',
                        payload: { clipId: CLIP_ID, velocity: 64 },
                    }),
                execute: () =>
                    handleSetAllVelocities.execute({
                        type: 'setAllVelocities',
                        payload: { clipId: CLIP_ID, velocity: 64 },
                    }),
            },
        ];

        for (const transform of transforms) {
            const before = seedNotes([note('a', 60, 0.11), note('b', 67, 0.62)]);
            const description = transform.describe();
            const inverse = requireRestoreAction(description.inverseAction);
            const replay = requireRestoreAction(description.redoAction);

            expect(description.label).toBe(transform.label);
            expect(transform.execute()).toEqual({ status: 'written' });
            const transformed = currentNotes().map((candidate) => ({ ...candidate }));
            expect(transformed).not.toEqual(before);
            const noteTransformReplayGuard = {
                trackId: TRACK_ID,
                expectedTrackFrozen: false as const,
                expectedClipLocked: false as const,
            };
            expect(inverse.payload).toEqual({
                clipId: CLIP_ID,
                notes: before,
                expectedNotes: transformed,
                noteTransformReplayGuard,
            });
            expect(replay.payload).toEqual({
                clipId: CLIP_ID,
                notes: transformed,
                expectedNotes: before,
                noteTransformReplayGuard,
            });

            expect(handleRestoreMidiClipNotes.execute(inverse)).toEqual({ status: 'written' });
            expect(currentNotes()).toEqual(before);
            expect(handleRestoreMidiClipNotes.execute(replay)).toEqual({ status: 'written' });
            expect(currentNotes()).toEqual(transformed);
        }
    });

    it('rejects a stale inverse without overwriting later note edits', () => {
        seedNotes([note('a', 60, 0.11)]);
        const action = { type: 'quantizeNotes' as const, payload: { clipId: CLIP_ID, gridSize: 0.25 } };
        const inverse = requireRestoreAction(handleQuantizeNotes.describe(action).inverseAction);
        expect(handleQuantizeNotes.execute(action)).toEqual({ status: 'written' });

        const laterNote = note('later', 72, 1.25);
        const state = midiStore.value;
        if (!state) {
            throw new Error('Expected MIDI state');
        }
        midiStore.set({
            ...state,
            notesByClipId: { ...state.notesByClipId, [CLIP_ID]: [...currentNotes(), laterNote] },
        });

        expect(handleRestoreMidiClipNotes.execute(inverse)).toEqual({ status: 'conflict' });
        expect(currentNotes()).toContainEqual(laterNote);
    });

    it('reports missing and unchanged transforms as no-ops', () => {
        expect(
            handleQuantizeNotes.isNoop?.({
                type: 'quantizeNotes',
                payload: { clipId: 'missing', gridSize: 0.25 },
            })
        ).toBe(true);
        expect(
            handleTransposeNotes.isNoop?.({
                type: 'transposeNotes',
                payload: { clipId: 'missing', semitones: 12 },
            })
        ).toBe(true);

        seedNotes([note('grid-aligned', 127, 0.5)]);
        expect(
            handleQuantizeNotes.isNoop?.({
                type: 'quantizeNotes',
                payload: { clipId: CLIP_ID, gridSize: 0.25 },
            })
        ).toBe(true);
        expect(
            handleTransposeNotes.isNoop?.({
                type: 'transposeNotes',
                payload: { clipId: CLIP_ID, semitones: 12 },
            })
        ).toBe(true);
    });

    it('returns no-write when a restore is already applied and conflicts when its clip disappeared', () => {
        const before = seedNotes([note('a', 60, 0.11)]);
        const inverse = requireRestoreAction(
            handleTransposeNotes.describe({
                type: 'transposeNotes',
                payload: { clipId: CLIP_ID, semitones: 12 },
            }).inverseAction
        );

        expect(currentNotes()).toEqual(before);
        expect(handleRestoreMidiClipNotes.execute(inverse)).toEqual({ status: 'no-write' });

        const state = midiStore.value;
        if (!state) {
            throw new Error('Expected MIDI state');
        }
        midiStore.set({ ...state, notesByClipId: {} });
        expect(handleRestoreMidiClipNotes.execute(inverse)).toEqual({ status: 'conflict' });
    });
});

describe('MIDI note transforms through AppAction execution', () => {
    beforeEach(() => {
        Container.clear();
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
        registerHandlerMap(getMidiNoteTransformHandlers());
        const notificationEventBus = createEventBus<NotificationEvents>();
        notifications = [];
        unsubscribeFromNotifications = notificationEventBus.on('ui.notify', (notification) => {
            notifications.push(notification);
        });
        setNotificationEventBus(notificationEventBus);
        clearUndoHistory();
        resetMidiClipTopology();
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    });

    afterEach(() => {
        clearUndoHistory();
        clearHandlerRegistry();
        unsubscribeFromNotifications();
        Container.clear();
        configureAutomergeStoragePort(null);
    });

    it('commits quantize through executeAppAction and round-trips exact state through undo and redo', async () => {
        const before = seedNotes([note('a', 60, 0.11), note('b', 64, 0.47)]);

        await executeAppAction({
            type: 'quantizeNotes',
            payload: { clipId: CLIP_ID, gridSize: 0.25 },
        });

        const transformed = currentNotes().map((candidate) => ({ ...candidate }));
        expect(transformed).not.toEqual(before);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.past[0]?.label).toBe('Quantize notes');

        await undo();

        expect(currentNotes()).toEqual(before);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(1);
        expect(notifications).toEqual([]);

        await redo();

        expect(currentNotes()).toEqual(transformed);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);
        expect(notifications).toEqual([]);
    });

    const atomicTransformCases = [
        {
            name: 'quantize notes',
            label: 'Quantize notes',
            action: { type: 'quantizeNotes', payload: { clipId: CLIP_ID, gridSize: 0.25 } } as const,
            expectedNotes: [atomicNote('a', 60, 0.25), atomicNote('b', 67, 1.25)],
        },
        {
            name: 'transpose notes',
            label: 'Transpose +5 semitones',
            action: { type: 'transposeNotes', payload: { clipId: CLIP_ID, semitones: 5 } } as const,
            expectedNotes: [atomicNote('a', 65, 0.125), atomicNote('b', 72, 1.25)],
        },
        {
            name: 'invert notes',
            label: 'Invert notes',
            action: { type: 'invertNotes', payload: { clipId: CLIP_ID } } as const,
            expectedNotes: [atomicNote('a', 67, 0.125), atomicNote('b', 60, 1.25)],
        },
        {
            name: 'retrograde notes',
            label: 'Retrograde notes',
            action: { type: 'retrogradeNotes', payload: { clipId: CLIP_ID } } as const,
            expectedNotes: [atomicNote('a', 60, 1.5), atomicNote('b', 67, 0.125)],
        },
        {
            name: 'quantize note lengths',
            label: 'Quantize note lengths',
            action: { type: 'quantizeNoteLengths', payload: { clipId: CLIP_ID, gridSize: 0.5 } } as const,
            expectedNotes: [atomicNote('a', 60, 0.125), atomicNote('b', 67, 1.25, { duration: 1 })],
        },
        {
            name: 'scale velocities',
            label: 'Scale velocities ×0.5',
            action: { type: 'scaleAllVelocities', payload: { clipId: CLIP_ID, factor: 0.5 } } as const,
            expectedNotes: [atomicNote('a', 60, 0.125, { velocity: 40 }), atomicNote('b', 67, 1.25, { velocity: 51 })],
        },
        {
            name: 'set velocities',
            label: 'Set all velocities to 96',
            action: { type: 'setAllVelocities', payload: { clipId: CLIP_ID, velocity: 96 } } as const,
            expectedNotes: [atomicNote('a', 60, 0.125, { velocity: 96 }), atomicNote('b', 67, 1.25, { velocity: 96 })],
        },
        {
            name: 'humanize notes with a fixed seed',
            label: 'Humanize notes',
            action: {
                type: 'humanizeNotes',
                payload: { clipId: CLIP_ID, amount: 0.4, velocityAmount: 0.5, seed: 42 },
            } as const,
            expectedNotes: [
                atomicNote('a', 60, 0.13511037519201635, { velocity: 80 }),
                atomicNote('b', 67, 1.285246579349041, { velocity: 102 }),
            ],
        },
    ];

    it.each(atomicTransformCases)('$name commits atomically and preserves exact undo and redo', async (testCase) => {
        const before = [atomicNote('a', 60, 0.125), atomicNote('b', 67, 1.25)];
        seedNotes(before);

        const result = await executeAppActionBatch([structuredClone(testCase.action)], {
            groupId: `atomic-${testCase.action.type}`,
            groupLabel: testCase.label,
            requireCompensation: true,
        });

        expect(result).toMatchObject({
            status: 'committed',
            actions: [{ action: { type: testCase.action.type } }],
        });
        expect(currentNotes()).toEqual(testCase.expectedNotes);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.past[0]?.label).toBe(testCase.label);
        expect(undoStore.value?.future).toEqual([]);

        await expect(undo()).resolves.toEqual({ headConsumed: true });
        expect(currentNotes()).toEqual(before);
        expect(undoStore.value?.past).toEqual([]);
        expect(undoStore.value?.future).toHaveLength(1);

        await redo();
        expect(currentNotes()).toEqual(testCase.expectedNotes);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toEqual([]);
    });

    it.each(['missing', 'wrong-kind', 'frozen', 'locked', 'ambiguous'] as const)(
        'refuses an atomic transform against a %s target before notes or undo change',
        async (invalidTarget) => {
            const before = [atomicNote('a', 60, 0.125), atomicNote('b', 67, 1.25)];
            seedNotes(before);
            setInvalidMidiTarget(invalidTarget);

            const result = await executeAppActionBatch(
                [{ type: 'setAllVelocities', payload: { clipId: CLIP_ID, velocity: 96 } }],
                { requireCompensation: true }
            );

            expect(result).toEqual({
                status: 'rejected',
                reason: 'Action is not compensable inside an atomic batch: setAllVelocities',
                actions: [],
            });
            expect(currentNotes()).toEqual(before);
            expect(undoStore.value?.past).toEqual([]);
            expect(undoStore.value?.future).toEqual([]);
        }
    );

    it.each(['missing', 'wrong-kind', 'frozen', 'locked', 'ambiguous'] as const)(
        'refuses a direct transform against a %s target without losing undo authority',
        async (invalidTarget) => {
            const before = [atomicNote('a', 60, 0.125), atomicNote('b', 67, 1.25)];
            seedNotes(before);
            setInvalidMidiTarget(invalidTarget);

            await expect(
                executeAppAction({ type: 'setAllVelocities', payload: { clipId: CLIP_ID, velocity: 96 } })
            ).rejects.toThrow('Action conflicts with current project state: setAllVelocities');

            expect(currentNotes()).toEqual(before);
            expect(undoStore.value?.past).toEqual([]);
            expect(undoStore.value?.future).toEqual([]);
        }
    );

    it.each(['missing', 'wrong-kind', 'frozen', 'locked', 'moved', 'changed-notes'] as const)(
        'keeps the guarded atomic undo pending when the target is %s',
        async (divergence) => {
            const before = [atomicNote('a', 60, 0.125), atomicNote('b', 67, 1.25)];
            const transformed = [
                atomicNote('a', 60, 0.125, { velocity: 96 }),
                atomicNote('b', 67, 1.25, { velocity: 96 }),
            ];
            seedNotes(before);
            await expect(
                executeAppActionBatch([{ type: 'setAllVelocities', payload: { clipId: CLIP_ID, velocity: 96 } }], {
                    requireCompensation: true,
                })
            ).resolves.toMatchObject({ status: 'committed' });

            const track = trackStore.value!.tracks[0]!;
            const clip = track.clips[0]!;
            if (divergence === 'missing') {
                setTrackStoreState({ ...defaultTrackState, tracks: [] });
            } else if (divergence === 'wrong-kind') {
                setTrackStoreState({
                    ...defaultTrackState,
                    tracks: [{ ...track, clips: [{ ...clip, type: 'audio' }] }],
                });
            } else if (divergence === 'frozen') {
                setTrackStoreState({ ...defaultTrackState, tracks: [{ ...track, frozen: true }] });
            } else if (divergence === 'locked') {
                setTrackStoreState({
                    ...defaultTrackState,
                    tracks: [{ ...track, clips: [{ ...clip, locked: true }] }],
                });
            } else if (divergence === 'moved') {
                const movedTrack = createTrack({ id: 'track-2', kind: 'midi', name: 'Moved MIDI' });
                setTrackStoreState({
                    ...defaultTrackState,
                    tracks: [
                        { ...track, clips: [] },
                        { ...movedTrack, clips: [{ ...clip, trackId: movedTrack.id }] },
                    ],
                });
            } else {
                const laterNote = atomicNote('b', 72, 2.5, { id: 'later' });
                midiStore.set({
                    ...midiStore.value!,
                    notesByClipId: { ...midiStore.value!.notesByClipId, [CLIP_ID]: [...transformed, laterNote] },
                });
            }

            await expect(undo()).resolves.toEqual({ headConsumed: false });
            let expectedCurrentNotes = transformed;
            if (divergence === 'changed-notes') {
                expectedCurrentNotes = [...transformed, atomicNote('b', 72, 2.5, { id: 'later' })];
            }
            expect(currentNotes()).toEqual(expectedCurrentNotes);
            expect(undoStore.value?.past).toHaveLength(1);
            expect(undoStore.value?.future).toEqual([]);
        }
    );

    it('keeps a stale redo entry and preserves edits made after undo', async () => {
        const before = seedNotes([note('a', 60, 0.11)]);
        await executeAppAction({
            type: 'transposeNotes',
            payload: { clipId: CLIP_ID, semitones: 7 },
        });
        await undo();

        const laterNote = note('later', 72, 1.25);
        const state = midiStore.value;
        if (!state) {
            throw new Error('Expected MIDI state');
        }
        midiStore.set({
            ...state,
            notesByClipId: { ...state.notesByClipId, [CLIP_ID]: [...before, laterNote] },
        });

        await expect(redo()).resolves.toBeUndefined();

        expect(currentNotes()).toEqual([...before, laterNote]);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(1);
        expect(notifications).toEqual([
            { message: 'Cannot redo "Transpose +7 semitones": project state has changed', level: 'warning' },
        ]);
    });

    it('keeps a stale transform undo entry and preserves later divergent notes', async () => {
        seedNotes([note('a', 60, 0.11)]);
        await executeAppAction({
            type: 'transposeNotes',
            payload: { clipId: CLIP_ID, semitones: 7 },
        });
        const laterNote = note('later', 72, 1.25);
        const state = midiStore.value;
        if (!state) {
            throw new Error('Expected MIDI state');
        }
        midiStore.set({
            ...state,
            notesByClipId: { ...state.notesByClipId, [CLIP_ID]: [...currentNotes(), laterNote] },
        });

        // The stale entry stays at the head of `past`, so the call consumed nothing.
        await expect(undo()).resolves.toEqual({ headConsumed: false });

        expect(currentNotes()).toContainEqual(laterNote);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(notifications).toEqual([
            { message: 'Cannot undo "Transpose +7 semitones": project state has changed', level: 'warning' },
        ]);
        expect(undoStore.value?.future).toHaveLength(0);
    });
});
