import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MidiStoreState } from '../../../stores/midiStore';

const mocks = vi.hoisted(() => {
    const state: { value: MidiStoreState | null } = { value: null };

    return {
        state,
        set: vi.fn((nextState: MidiStoreState | null): void => {
            state.value = nextState;
        }),
    };
});

vi.mock('../../../stores/midiStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../stores/midiStore')>();

    return {
        ...actual,
        midiStore: {
            get value(): MidiStoreState | null {
                return mocks.state.value;
            },
            set: mocks.set,
        },
    };
});

const { prepareMidiGlobalTimeTransaction } = await import('../prepareMidiGlobalTimeTransaction');

type PrepareInput = Parameters<typeof prepareMidiGlobalTimeTransaction>[0];
type Owner = PrepareInput['owners'][number];
type Clip = Owner['clips'][number];
type ReplayPlan = ReturnType<typeof prepareMidiGlobalTimeTransaction>['replayPlan'];

function state(overrides: Partial<MidiStoreState> = {}): MidiStoreState {
    return {
        probabilitySeed: 7,
        notesByClipId: {},
        ccByClipId: {},
        pitchBendByClipId: {},
        ...overrides,
    };
}

function clip(clipId: string, startBeat = 0, endBeat = 8, midiOffsetBeats?: number): Clip {
    return {
        clipId,
        startBeat,
        endBeat,
        ...(midiOffsetBeats === undefined ? {} : { midiOffsetBeats }),
    };
}

function owner(trackId: string, eligible: boolean, clips: readonly Clip[]): Owner {
    return { trackId, eligible, clips };
}

function requireState(): MidiStoreState {
    const value = mocks.state.value;
    if (!value) {
        throw new Error('Expected MIDI state');
    }
    return value;
}

function duplicateInput(replayPlan?: ReplayPlan): PrepareInput {
    return {
        operation: {
            type: 'duplicate',
            startBeat: 0,
            endBeat: 4,
            copies: [{ sourceClipId: 'source', newClipId: 'target' }],
        },
        owners: [owner('track-1', true, [clip('source', 0, 8)])],
        ...(replayPlan === undefined ? {} : { replayPlan }),
    };
}

function deleteInput(): PrepareInput {
    return {
        operation: {
            type: 'delete',
            startBeat: 2,
            endBeat: 4,
            splits: [{ sourceClipId: 'source', newClipId: 'target', splitBeat: 2 }],
            removeClipIds: [],
        },
        owners: [owner('track-1', true, [clip('source', 0, 8)])],
    };
}

function withUnexpectedKey<Value extends object>(value: Value): Value {
    Object.assign(value, { unexpected: true });
    return value;
}

describe('prepareMidiGlobalTimeTransaction', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mocks.state.value = null;
        mocks.set.mockReset();
        mocks.set.mockImplementation((nextState: MidiStoreState | null): void => {
            mocks.state.value = nextState;
        });
    });

    it('preserves insert parity across notes, CC, and pitch bend while preparation stays effect-free', () => {
        const dormantNotes = [{ id: 'dormant', pitch: 40, startBeat: 4, duration: 1, velocity: 70 }];
        const migratedAbsoluteNoteClipIds = ['target'];
        const futureMetadata = { retained: true };
        const preparedState = {
            ...state({
                notesByClipId: {
                    target: [{ id: 'note-1', pitch: 60, startBeat: 4, duration: 1, velocity: 100 }],
                    dormant: dormantNotes,
                },
                ccByClipId: {
                    target: [{ id: 'cc-1', controller: 74, value: 64, beat: 4, channel: 1 }],
                },
                pitchBendByClipId: {
                    target: [{ id: 'pb-1', value: 0.25, beat: 4, channel: 1 }],
                },
                migratedAbsoluteNoteClipIds,
            }),
            futureMetadata,
        };
        mocks.state.value = preparedState;

        const transaction = prepareMidiGlobalTimeTransaction({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
            owners: [owner('track-1', true, [clip('target')]), owner('track-vca', false, [clip('dormant')])],
        });

        expect(transaction.status).toBe('ready');
        expect(transaction.hasChanges).toBe(true);
        expect(transaction.replayPlan).toEqual({ version: 1, notes: [] });
        expect(transaction.inversePlan).not.toBeNull();
        expect(JSON.parse(JSON.stringify(transaction.inversePlan))).toEqual(transaction.inversePlan);
        expect(mocks.state.value).toBe(preparedState);
        expect(mocks.set).not.toHaveBeenCalled();

        expect(transaction.apply()).toBe(true);
        const appliedState = requireState();
        expect(appliedState.notesByClipId.target?.[0]?.startBeat).toBe(6);
        expect(appliedState.ccByClipId.target?.[0]?.beat).toBe(6);
        expect(appliedState.pitchBendByClipId.target?.[0]?.beat).toBe(6);
        expect(appliedState.notesByClipId.dormant).toBe(dormantNotes);
        expect(appliedState.migratedAbsoluteNoteClipIds).toBe(migratedAbsoluteNoteClipIds);
        expect(appliedState).toEqual(expect.objectContaining({ futureMetadata }));
    });

    it('performs ordered note splits followed by named all-map removals and restores exact state', () => {
        const sourceCc = [{ id: 'source-cc', controller: 1, value: 2, beat: 3, channel: 1 }];
        const preparedState = state({
            notesByClipId: {
                source: [
                    {
                        id: 'span',
                        pitch: 67,
                        startBeat: 2,
                        duration: 6,
                        velocity: 90,
                        probability: 55,
                        channel: 4,
                    },
                ],
                remove: [{ id: 'remove-note', pitch: 60, startBeat: 0, duration: 1, velocity: 80 }],
            },
            ccByClipId: {
                source: sourceCc,
                remove: [{ id: 'remove-cc', controller: 2, value: 3, beat: 0, channel: 1 }],
            },
            pitchBendByClipId: {
                remove: [{ id: 'remove-pb', value: 0.2, beat: 0, channel: 1 }],
            },
        });
        mocks.state.value = preparedState;

        const transaction = prepareMidiGlobalTimeTransaction({
            operation: {
                type: 'delete',
                startBeat: 4,
                endBeat: 8,
                splits: [{ sourceClipId: 'source', newClipId: 'right', splitBeat: 4, discardBeforeBeat: 4 }],
                removeClipIds: ['remove'],
            },
            owners: [owner('track-1', true, [clip('source', 0, 8, 0), clip('remove')])],
        });

        expect(transaction.status).toBe('ready');
        expect(transaction.replayPlan.notes).toHaveLength(1);
        expect(transaction.replayPlan.notes[0]).toMatchObject({
            role: 'split-right',
            sourceClipId: 'source',
            sourceNoteId: 'span',
            sourceNoteIndex: 0,
            targetClipId: 'right',
        });
        expect(transaction.apply()).toBe(true);
        const appliedState = requireState();
        expect(appliedState.notesByClipId.source?.[0]).toMatchObject({ id: 'span', duration: 2, channel: 4 });
        expect(appliedState.notesByClipId.right?.[0]).toMatchObject({
            id: transaction.replayPlan.notes[0]?.targetNoteId,
            startBeat: 0,
            duration: 4,
            probability: 55,
        });
        // Both halves of a split keep the source note's MPE routing (#1832 F8);
        // the right half used to be rebuilt without it and fell back to 0.
        expect(appliedState.notesByClipId.right?.[0]?.channel).toBe(4);
        expect(appliedState.ccByClipId.source).toBe(sourceCc);
        expect(appliedState.notesByClipId).not.toHaveProperty('remove');
        expect(appliedState.ccByClipId).not.toHaveProperty('remove');
        expect(appliedState.pitchBendByClipId).not.toHaveProperty('remove');

        expect(transaction.revert()).toBe(true);
        expect(mocks.state.value).toBe(preparedState);
    });

    it('performs the insert shift before note-only duplicate copy', () => {
        const preparedState = state({
            notesByClipId: {
                source: [
                    {
                        id: 'source-note',
                        pitch: 130,
                        startBeat: 4,
                        duration: 0,
                        velocity: 0,
                        channel: 12,
                    },
                ],
            },
            ccByClipId: { source: [{ id: 'cc', controller: 1, value: 2, beat: 4, channel: 1 }] },
            pitchBendByClipId: { source: [{ id: 'pb', value: 0.5, beat: 4, channel: 1 }] },
        });
        mocks.state.value = preparedState;

        const transaction = prepareMidiGlobalTimeTransaction(duplicateInput());

        expect(transaction.replayPlan.notes).toHaveLength(1);
        expect(transaction.replayPlan.notes[0]?.role).toBe('duplicate-clone');
        expect(transaction.apply()).toBe(true);
        const appliedState = requireState();
        expect(appliedState.notesByClipId.source?.[0]?.startBeat).toBe(8);
        expect(appliedState.ccByClipId.source?.[0]?.beat).toBe(8);
        expect(appliedState.pitchBendByClipId.source?.[0]?.beat).toBe(8);
        expect(appliedState.notesByClipId.target).toEqual([
            {
                id: transaction.replayPlan.notes[0]?.targetNoteId,
                pitch: 127,
                startBeat: 8,
                duration: 0.0625,
                velocity: 1,
                probability: 100,
                // Carried from the source note — a duplicate that loses the
                // MPE channel is re-routed to channel 0 (#1832 F8).
                channel: 12,
            },
        ]);
        expect(appliedState.ccByClipId).not.toHaveProperty('target');
        expect(appliedState.pitchBendByClipId).not.toHaveProperty('target');
    });

    it('validates and reuses a supplied replay plan byte-for-byte', () => {
        const preparedState = state({
            notesByClipId: {
                source: [{ id: 'source-note', pitch: 60, startBeat: 1, duration: 1, velocity: 90 }],
            },
        });
        mocks.state.value = preparedState;
        const randomUuid = vi.spyOn(crypto, 'randomUUID');
        const first = prepareMidiGlobalTimeTransaction(duplicateInput());
        const replayPlan = first.replayPlan;
        expect(randomUuid).toHaveBeenCalledTimes(1);
        randomUuid.mockClear();

        const replay = prepareMidiGlobalTimeTransaction(duplicateInput(replayPlan));

        expect(replay.status).toBe('ready');
        expect(replay.replayPlan).toBe(replayPlan);
        expect(replay.replayPlan.notes).toBe(replayPlan.notes);
        expect(replay.inversePlan).not.toBeNull();
        expect(randomUuid).not.toHaveBeenCalled();
        expect(replay.apply()).toBe(true);
        expect(requireState().notesByClipId.target?.[0]?.id).toBe(replayPlan.notes[0]?.targetNoteId);
    });

    it('captures an independent inverse snapshot without allocating another note identity', () => {
        const preparedState = state({
            notesByClipId: {
                source: [{ id: 'source-note', pitch: -0, startBeat: 1, duration: 1, velocity: 90 }],
            },
        });
        mocks.state.value = preparedState;
        const randomUuid = vi.spyOn(crypto, 'randomUUID');

        const transaction = prepareMidiGlobalTimeTransaction(duplicateInput());

        expect(transaction.status).toBe('ready');
        expect(transaction.inversePlan).not.toBeNull();
        expect(randomUuid).toHaveBeenCalledTimes(1);
        const serializedPlan = JSON.stringify(transaction.inversePlan);
        preparedState.notesByClipId.source![0]!.pitch = 12;
        expect(JSON.stringify(transaction.inversePlan)).toBe(serializedPlan);
        expect(JSON.parse(serializedPlan)).toEqual(transaction.inversePlan);
    });

    it.each([
        {
            name: 'missing entry',
            plan: { version: 1 as const, notes: [] },
        },
        {
            name: 'extra entry',
            plan: {
                version: 1 as const,
                notes: [
                    {
                        role: 'duplicate-clone' as const,
                        sourceClipId: 'source',
                        sourceNoteId: 'source-note',
                        sourceNoteIndex: 0,
                        targetClipId: 'target',
                        targetNoteId: 'note-new',
                    },
                    {
                        role: 'duplicate-clone' as const,
                        sourceClipId: 'source',
                        sourceNoteId: 'source-note',
                        sourceNoteIndex: 0,
                        targetClipId: 'target',
                        targetNoteId: 'note-extra',
                    },
                ],
            },
        },
        {
            name: 'mismatched source',
            plan: {
                version: 1 as const,
                notes: [
                    {
                        role: 'duplicate-clone' as const,
                        sourceClipId: 'other',
                        sourceNoteId: 'source-note',
                        sourceNoteIndex: 0,
                        targetClipId: 'target',
                        targetNoteId: 'note-new',
                    },
                ],
            },
        },
        {
            name: 'colliding identity',
            plan: {
                version: 1 as const,
                notes: [
                    {
                        role: 'duplicate-clone' as const,
                        sourceClipId: 'source',
                        sourceNoteId: 'source-note',
                        sourceNoteIndex: 0,
                        targetClipId: 'target',
                        targetNoteId: 'source-note',
                    },
                ],
            },
        },
    ])('rejects a $name replay plan without writes', ({ plan }) => {
        const preparedState = state({
            notesByClipId: {
                source: [{ id: 'source-note', pitch: 60, startBeat: 1, duration: 1, velocity: 90 }],
            },
        });
        mocks.state.value = preparedState;

        const transaction = prepareMidiGlobalTimeTransaction(duplicateInput(plan));

        expect(transaction.status).toBe('rejected');
        expect(transaction.hasChanges).toBe(false);
        expect(transaction.inversePlan).toBeNull();
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
        expect(mocks.state.value).toBe(preparedState);
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('rejects incomplete ownership before identity allocation', () => {
        const preparedState = state({
            notesByClipId: {
                source: [{ id: 'source-note', pitch: 60, startBeat: 1, duration: 1, velocity: 90 }],
                unknown: [],
            },
        });
        mocks.state.value = preparedState;
        const randomUuid = vi.spyOn(crypto, 'randomUUID');

        const transaction = prepareMidiGlobalTimeTransaction(duplicateInput());

        expect(transaction.status).toBe('rejected');
        expect(randomUuid).not.toHaveBeenCalled();
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('rejects mixed operation fields before identity allocation', () => {
        const preparedState = state({
            notesByClipId: {
                source: [{ id: 'source-note', pitch: 60, startBeat: 1, duration: 1, velocity: 90 }],
            },
        });
        mocks.state.value = preparedState;
        const randomUuid = vi.spyOn(crypto, 'randomUUID');
        const input = duplicateInput();
        Object.assign(input.operation, { splits: [], removeClipIds: [] });

        const transaction = prepareMidiGlobalTimeTransaction(input);

        expect(transaction.status).toBe('rejected');
        expect(transaction.hasChanges).toBe(false);
        expect(randomUuid).not.toHaveBeenCalled();
        expect(mocks.state.value).toBe(preparedState);
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it.each([
        {
            name: 'top-level input',
            createInput: () => withUnexpectedKey(duplicateInput()),
        },
        {
            name: 'owner snapshot',
            createInput: () => ({
                ...duplicateInput(),
                owners: [withUnexpectedKey(owner('track-1', true, [clip('source')]))],
            }),
        },
        {
            name: 'clip snapshot',
            createInput: () => ({
                ...duplicateInput(),
                owners: [owner('track-1', true, [withUnexpectedKey(clip('source'))])],
            }),
        },
        {
            name: 'insert operation',
            createInput: () => ({
                operation: withUnexpectedKey({ type: 'insert' as const, atBeat: 2, durationBeats: 2 }),
                owners: [owner('track-1', true, [clip('source')])],
            }),
        },
        {
            name: 'delete operation',
            createInput: () => {
                const input = deleteInput();
                withUnexpectedKey(input.operation);
                return input;
            },
        },
        {
            name: 'split command',
            createInput: () => {
                const input = deleteInput();
                if (input.operation.type !== 'delete') {
                    throw new Error('Expected delete input');
                }
                const split = input.operation.splits[0];
                if (!split) {
                    throw new Error('Expected split command');
                }
                withUnexpectedKey(split);
                return input;
            },
        },
        {
            name: 'copy command',
            createInput: () => {
                const input = duplicateInput();
                if (input.operation.type !== 'duplicate') {
                    throw new Error('Expected duplicate input');
                }
                const copy = input.operation.copies[0];
                if (!copy) {
                    throw new Error('Expected copy command');
                }
                withUnexpectedKey(copy);
                return input;
            },
        },
    ])('rejects an unexpected key in the $name schema before effects', ({ createInput }) => {
        const preparedState = state({
            notesByClipId: {
                source: [{ id: 'source-note', pitch: 60, startBeat: 1, duration: 2, velocity: 90 }],
            },
        });
        mocks.state.value = preparedState;
        const randomUuid = vi.spyOn(crypto, 'randomUUID');

        const transaction = prepareMidiGlobalTimeTransaction(createInput());

        expect(transaction.status).toBe('rejected');
        expect(transaction.hasChanges).toBe(false);
        expect(randomUuid).not.toHaveBeenCalled();
        expect(mocks.state.value).toBe(preparedState);
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it.each([
        {
            name: 'duplicate owner',
            owners: [owner('track-1', true, [clip('source')]), owner('track-1', true, [clip('target')])],
        },
        {
            name: 'contradictory clip owner',
            owners: [owner('track-1', true, [clip('source')]), owner('track-2', true, [clip('source')])],
        },
        {
            name: 'dormant operation target',
            owners: [owner('track-1', false, [clip('source')]), owner('track-2', true, [clip('target')])],
        },
    ])('rejects a $name as one unit', ({ owners }) => {
        const preparedState = state({
            notesByClipId: {
                source: [{ id: 'source-note', pitch: 60, startBeat: 1, duration: 1, velocity: 90 }],
            },
        });
        mocks.state.value = preparedState;
        const input = duplicateInput();

        const transaction = prepareMidiGlobalTimeTransaction({ ...input, owners });

        expect(transaction.status).toBe('rejected');
        expect(transaction.hasChanges).toBe(false);
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('rejects a colliding target clip and invalid or overflowing operation data', () => {
        const preparedState = state({
            notesByClipId: {
                source: [{ id: 'source-note', pitch: 60, startBeat: 1, duration: 1, velocity: 90 }],
                target: [],
            },
        });
        mocks.state.value = preparedState;

        const collidingInput = duplicateInput();
        expect(
            prepareMidiGlobalTimeTransaction({
                ...collidingInput,
                owners: [owner('track-1', true, [clip('source'), clip('target')])],
            }).status
        ).toBe('rejected');
        expect(
            prepareMidiGlobalTimeTransaction({
                operation: { type: 'insert', atBeat: Number.MAX_VALUE, durationBeats: Number.MAX_VALUE },
                owners: [owner('track-1', true, [clip('source')])],
            }).status
        ).toBe('rejected');
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('reports truthful ready no-change for empty eligible data', () => {
        const preparedState = state();
        mocks.state.value = preparedState;

        const transaction = prepareMidiGlobalTimeTransaction({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
            owners: [],
        });

        expect(transaction.status).toBe('ready');
        expect(transaction.hasChanges).toBe(false);
        expect(transaction.replayPlan).toEqual({ version: 1, notes: [] });
        expect(transaction.inversePlan).toBeNull();
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('stale-checks, closes on repeated/out-of-order use, and restores only after its own apply', () => {
        const preparedState = state({
            notesByClipId: {
                source: [{ id: 'source-note', pitch: 60, startBeat: 4, duration: 1, velocity: 90 }],
            },
        });
        mocks.state.value = preparedState;
        const stale = prepareMidiGlobalTimeTransaction({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
            owners: [owner('track-1', true, [clip('source')])],
        });
        mocks.state.value = { ...preparedState };

        expect(stale.apply()).toBe(false);
        mocks.state.value = preparedState;
        expect(stale.apply()).toBe(false);

        const outOfOrder = prepareMidiGlobalTimeTransaction({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
            owners: [owner('track-1', true, [clip('source')])],
        });
        expect(outOfOrder.revert()).toBe(false);
        expect(outOfOrder.apply()).toBe(false);

        const applied = prepareMidiGlobalTimeTransaction({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
            owners: [owner('track-1', true, [clip('source')])],
        });
        expect(applied.apply()).toBe(true);
        expect(applied.apply()).toBe(false);
        expect(applied.revert()).toBe(false);
    });

    it('closes when either transaction state is mutated in place', () => {
        const preparedState = state({
            notesByClipId: {
                source: [{ id: 'source-note', pitch: 60, startBeat: 4, duration: 1, velocity: 90 }],
            },
        });
        const input: PrepareInput = {
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
            owners: [owner('track-1', true, [clip('source')])],
        };
        mocks.state.value = preparedState;
        const staleApply = prepareMidiGlobalTimeTransaction(input);
        preparedState.notesByClipId.source![0]!.startBeat = 99;

        expect(staleApply.apply()).toBe(false);
        expect(mocks.state.value).toBe(preparedState);
        expect(mocks.set).not.toHaveBeenCalled();

        const revertSourceState = state({
            notesByClipId: {
                source: [{ id: 'source-note', pitch: 60, startBeat: 4, duration: 1, velocity: 90 }],
            },
        });
        mocks.state.value = revertSourceState;
        const staleRevert = prepareMidiGlobalTimeTransaction(input);
        expect(staleRevert.apply()).toBe(true);
        const appliedState = requireState();
        appliedState.notesByClipId.source![0]!.startBeat = 99;

        expect(staleRevert.revert()).toBe(false);
        expect(mocks.state.value).toBe(appliedState);
        expect(mocks.set).toHaveBeenCalledTimes(1);
    });

    it('keeps an in-flight apply revertible after a synchronous reentrant revert', () => {
        const preparedState = state({
            notesByClipId: {
                source: [{ id: 'source-note', pitch: 60, startBeat: 4, duration: 1, velocity: 90 }],
            },
        });
        mocks.state.value = preparedState;
        let transaction: ReturnType<typeof prepareMidiGlobalTimeTransaction> | undefined;
        let reentrantResult: boolean | undefined;
        mocks.set.mockImplementationOnce((nextState: MidiStoreState | null): void => {
            mocks.state.value = nextState;
            if (!transaction) {
                throw new Error('Expected transaction');
            }
            reentrantResult = transaction.revert();
        });
        transaction = prepareMidiGlobalTimeTransaction({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
            owners: [owner('track-1', true, [clip('source')])],
        });

        expect(transaction.apply()).toBe(true);
        expect(reentrantResult).toBe(false);
        expect(mocks.state.value).not.toBe(preparedState);
        expect(transaction.revert()).toBe(true);
        expect(mocks.state.value).toBe(preparedState);
    });

    it('fails closed for failed publication', () => {
        const preparedState = state({
            notesByClipId: {
                source: [{ id: 'source-note', pitch: 60, startBeat: 4, duration: 1, velocity: 90 }],
            },
        });
        mocks.state.value = preparedState;

        const failure = new Error('publication failed');
        mocks.set.mockImplementationOnce(() => {
            throw failure;
        });
        const failed = prepareMidiGlobalTimeTransaction({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
            owners: [owner('track-1', true, [clip('source')])],
        });
        expect(() => failed.apply()).toThrow(failure);
        expect(failed.apply()).toBe(false);
        expect(failed.revert()).toBe(false);
    });

    it('fails closed for stale revert and publication that does not retain the prepared identity', () => {
        const preparedState = state({
            notesByClipId: {
                source: [{ id: 'source-note', pitch: 60, startBeat: 4, duration: 1, velocity: 90 }],
            },
        });
        const input: PrepareInput = {
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
            owners: [owner('track-1', true, [clip('source')])],
        };
        mocks.state.value = preparedState;
        const staleRevert = prepareMidiGlobalTimeTransaction(input);
        expect(staleRevert.apply()).toBe(true);
        const appliedState = requireState();
        const interveningState = state();
        mocks.state.value = interveningState;

        expect(staleRevert.revert()).toBe(false);
        mocks.state.value = appliedState;
        expect(staleRevert.revert()).toBe(false);

        mocks.state.value = preparedState;
        mocks.set.mockReset();
        mocks.set.mockImplementationOnce(() => undefined);
        const hiddenApply = prepareMidiGlobalTimeTransaction(input);
        expect(hiddenApply.apply()).toBe(false);
        expect(mocks.state.value).toBe(preparedState);
        expect(hiddenApply.revert()).toBe(false);

        mocks.set.mockReset();
        mocks.set.mockImplementation((nextState: MidiStoreState | null): void => {
            mocks.state.value = nextState;
        });
        const hiddenRevert = prepareMidiGlobalTimeTransaction(input);
        expect(hiddenRevert.apply()).toBe(true);
        const hiddenAppliedState = requireState();
        mocks.set.mockImplementationOnce(() => undefined);
        expect(hiddenRevert.revert()).toBe(false);
        expect(mocks.state.value).toBe(hiddenAppliedState);
    });
});
