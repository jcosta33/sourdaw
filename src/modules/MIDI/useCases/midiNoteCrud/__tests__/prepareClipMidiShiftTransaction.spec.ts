import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MidiCC, MidiNote, MidiPitchBend } from '../../../models/MidiNote';
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

vi.mock('../../../stores/midiStore', () => ({
    midiStore: {
        get value(): MidiStoreState | null {
            return mocks.state.value;
        },
        set: mocks.set,
    },
}));

const { prepareClipMidiShiftTransaction } = await import('../prepareClipMidiShiftTransaction');

function note(startBeat: number, id = 'note-1'): MidiNote {
    return {
        id,
        pitch: 60,
        startBeat,
        duration: 1,
        velocity: 100,
    };
}

function cc(beat: number, id = 'cc-1'): MidiCC {
    return {
        id,
        controller: 1,
        value: 64,
        beat,
        channel: 0,
    };
}

function pitchBend(beat: number, id = 'pitch-bend-1'): MidiPitchBend {
    return {
        id,
        value: 0.5,
        beat,
        channel: 0,
    };
}

function midiState(overrides: Partial<MidiStoreState> = {}): MidiStoreState {
    return {
        probabilitySeed: 0x1234_5678,
        notesByClipId: {},
        ccByClipId: {},
        pitchBendByClipId: {},
        ...overrides,
    };
}

function requireState(): MidiStoreState {
    const state = mocks.state.value;
    if (!state) {
        throw new Error('Expected a MIDI store state');
    }
    return state;
}

function expectRejected(state: MidiStoreState | null, clipId: string, beatDelta: number): void {
    mocks.state.value = state;
    mocks.set.mockClear();

    const transaction = prepareClipMidiShiftTransaction({ clipId, beatDelta });

    expect(transaction.status).toBe('rejected');
    expect(transaction.hasChanges).toBe(false);
    expect(mocks.state.value).toBe(state);
    expect(transaction.apply()).toBe(false);
    expect(transaction.revert()).toBe(false);
    expect(mocks.set).not.toHaveBeenCalled();
}

function expectReadyNoChange(state: MidiStoreState, clipId: string, beatDelta: number): void {
    mocks.state.value = state;
    mocks.set.mockClear();

    const transaction = prepareClipMidiShiftTransaction({ clipId, beatDelta });

    expect(transaction.status).toBe('ready');
    expect(transaction.hasChanges).toBe(false);
    expect(mocks.state.value).toBe(state);
    expect(transaction.apply()).toBe(false);
    expect(transaction.revert()).toBe(false);
    expect(mocks.set).not.toHaveBeenCalled();
}

describe('prepareClipMidiShiftTransaction', () => {
    beforeEach(() => {
        mocks.state.value = null;
        mocks.set.mockReset();
        mocks.set.mockImplementation((nextState: MidiStoreState | null): void => {
            mocks.state.value = nextState;
        });
    });

    it('prepares without effects and shifts every target event family exactly once', () => {
        const targetNotes = [
            { ...note(3), probability: 75, pressure: 0.25 },
            { ...note(1, 'note-2'), pitch: 72, duration: 2, velocity: 81, channel: 3 },
        ];
        const targetCcs = [
            { ...cc(4), controller: 74, value: 96, channel: 2 },
            { ...cc(1, 'cc-2'), controller: 11, value: 32, channel: 5 },
        ];
        const targetPitchBends = [
            { ...pitchBend(5), value: 0.75, channel: 4 },
            { ...pitchBend(0.5, 'pitch-bend-2'), value: -0.5, channel: 7 },
        ];
        const unrelatedNotes = [note(8, 'unrelated-note')];
        const unrelatedCcs = [cc(9, 'unrelated-cc')];
        const unrelatedPitchBends = [pitchBend(10, 'unrelated-pitch-bend')];
        const migratedAbsoluteNoteClipIds = ['target', 'other'];
        const futureMetadata = { retained: true };
        const preparedState = {
            ...midiState({
                notesByClipId: { target: targetNotes, other: unrelatedNotes },
                ccByClipId: { target: targetCcs, other: unrelatedCcs },
                pitchBendByClipId: { target: targetPitchBends, other: unrelatedPitchBends },
                migratedAbsoluteNoteClipIds,
            }),
            futureMetadata,
        };
        mocks.state.value = preparedState;

        const transaction = prepareClipMidiShiftTransaction({
            clipId: 'target',
            beatDelta: -2,
        });

        expect(transaction.status).toBe('ready');
        expect(transaction.hasChanges).toBe(true);
        expect(mocks.state.value).toBe(preparedState);
        expect(mocks.set).not.toHaveBeenCalled();
        expect(targetNotes.map(({ startBeat }) => startBeat)).toEqual([3, 1]);
        expect(targetCcs.map(({ beat }) => beat)).toEqual([4, 1]);
        expect(targetPitchBends.map(({ beat }) => beat)).toEqual([5, 0.5]);

        expect(transaction.apply()).toBe(true);
        expect(mocks.set).toHaveBeenCalledTimes(1);
        const appliedState = requireState();
        expect(appliedState).not.toBe(preparedState);
        expect(appliedState.notesByClipId.target).toEqual(
            targetNotes.map((midiNote) => ({ ...midiNote, startBeat: midiNote.startBeat - 2 }))
        );
        expect(appliedState.ccByClipId.target).toEqual(
            targetCcs.map((midiCc) => ({ ...midiCc, beat: midiCc.beat - 2 }))
        );
        expect(appliedState.pitchBendByClipId.target).toEqual(
            targetPitchBends.map((midiPitchBend) => ({ ...midiPitchBend, beat: midiPitchBend.beat - 2 }))
        );
        expect(appliedState.notesByClipId.other).toBe(unrelatedNotes);
        expect(appliedState.ccByClipId.other).toBe(unrelatedCcs);
        expect(appliedState.pitchBendByClipId.other).toBe(unrelatedPitchBends);
        expect(appliedState.probabilitySeed).toBe(preparedState.probabilitySeed);
        expect(appliedState.migratedAbsoluteNoteClipIds).toBe(migratedAbsoluteNoteClipIds);
        expect(appliedState).toEqual(expect.objectContaining({ futureMetadata }));
        expect(transaction.revert()).toBe(true);
        expect(mocks.state.value).toBe(preparedState);
        expect(mocks.set).toHaveBeenNthCalledWith(2, preparedState);
        expect(transaction.revert()).toBe(false);
        expect(transaction.apply()).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(2);
    });

    it.each<[string, MidiStoreState, (state: MidiStoreState) => number | undefined]>([
        ['CC', midiState({ ccByClipId: { target: [cc(1)] } }), (state) => state.ccByClipId.target?.[0]?.beat],
        [
            'pitch bend',
            midiState({ pitchBendByClipId: { target: [pitchBend(1)] } }),
            (state) => state.pitchBendByClipId.target?.[0]?.beat,
        ],
    ])('applies and exactly reverts a %s-only clip without notes', (_family, preparedState, readBeat) => {
        mocks.state.value = preparedState;
        const transaction = prepareClipMidiShiftTransaction({
            clipId: 'target',
            beatDelta: 2,
        });

        expect(transaction.status).toBe('ready');
        expect(transaction.hasChanges).toBe(true);
        expect(transaction.apply()).toBe(true);
        expect(readBeat(requireState())).toBe(3);
        expect(transaction.revert()).toBe(true);
        expect(mocks.state.value).toBe(preparedState);
        expect(readBeat(requireState())).toBe(1);
        expect(mocks.set).toHaveBeenCalledTimes(2);
    });

    it('rejects missing state, an empty clip id, and every non-finite delta', () => {
        const preparedState = midiState({
            notesByClipId: { target: [note(1)] },
        });

        expectRejected(null, 'target', 1);
        expectRejected(preparedState, '', 1);
        expectRejected(preparedState, 'target', Number.NaN);
        expectRejected(preparedState, 'target', Number.POSITIVE_INFINITY);
        expectRejected(preparedState, 'target', Number.NEGATIVE_INFINITY);
    });

    it.each<[string, MidiStoreState]>([
        [
            'note',
            midiState({
                notesByClipId: { target: [note(Number.MAX_VALUE)] },
            }),
        ],
        [
            'CC',
            midiState({
                ccByClipId: { target: [cc(Number.MAX_VALUE)] },
            }),
        ],
        [
            'pitch bend',
            midiState({
                pitchBendByClipId: { target: [pitchBend(Number.MAX_VALUE)] },
            }),
        ],
    ])('rejects before writes when a computed %s beat is non-finite', (_family, preparedState) => {
        expectRejected(preparedState, 'target', Number.MAX_VALUE);
    });

    it('reports ready no-change for zero delta, missing target data, and empty target collections', () => {
        expectReadyNoChange(
            midiState({
                notesByClipId: { target: [note(1)] },
                ccByClipId: { target: [cc(2)] },
                pitchBendByClipId: { target: [pitchBend(3)] },
            }),
            'target',
            0
        );
        expectReadyNoChange(
            midiState({
                notesByClipId: { other: [note(1)] },
                ccByClipId: { other: [cc(2)] },
                pitchBendByClipId: { other: [pitchBend(3)] },
            }),
            'target',
            1
        );
        expectReadyNoChange(
            midiState({
                notesByClipId: { target: [] },
                ccByClipId: { target: [] },
                pitchBendByClipId: { target: [] },
            }),
            'target',
            1
        );
    });

    it('reports ready no-change when every finite shifted beat rounds to its original value', () => {
        const preparedState = midiState({
            notesByClipId: { target: [note(Number.MAX_VALUE)] },
            ccByClipId: { target: [cc(Number.MAX_VALUE)] },
            pitchBendByClipId: { target: [pitchBend(Number.MAX_VALUE)] },
        });

        expectReadyNoChange(preparedState, 'target', Number.MIN_VALUE);
    });

    it('refuses a stale apply by exact state identity and closes the handle', () => {
        const preparedState = midiState({
            notesByClipId: { target: [note(1)] },
        });
        mocks.state.value = preparedState;
        const transaction = prepareClipMidiShiftTransaction({
            clipId: 'target',
            beatDelta: 1,
        });
        const equalStateWithNewIdentity = {
            ...preparedState,
        };
        mocks.state.value = equalStateWithNewIdentity;

        expect(transaction.apply()).toBe(false);
        expect(mocks.state.value).toBe(equalStateWithNewIdentity);
        expect(mocks.set).not.toHaveBeenCalled();

        mocks.state.value = preparedState;
        expect(transaction.apply()).toBe(false);
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('closes the handle after an out-of-order revert', () => {
        const preparedState = midiState({
            notesByClipId: { target: [note(1)] },
        });
        mocks.state.value = preparedState;
        const transaction = prepareClipMidiShiftTransaction({
            clipId: 'target',
            beatDelta: 1,
        });

        expect(transaction.revert()).toBe(false);
        expect(transaction.apply()).toBe(false);
        expect(mocks.state.value).toBe(preparedState);
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('closes the handle after a repeated apply without a second write', () => {
        const preparedState = midiState({
            notesByClipId: { target: [note(1)] },
        });
        mocks.state.value = preparedState;
        const transaction = prepareClipMidiShiftTransaction({
            clipId: 'target',
            beatDelta: 1,
        });

        expect(transaction.apply()).toBe(true);
        const appliedState = requireState();
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
        expect(mocks.state.value).toBe(appliedState);
        expect(mocks.set).toHaveBeenCalledTimes(1);
    });

    it.each(['apply', 'revert'] as const)(
        'stays closed after reentrant %s during apply publication',
        (reentrantOperation) => {
            const preparedState = midiState({
                notesByClipId: { target: [note(1)] },
            });
            mocks.state.value = preparedState;
            let transaction: ReturnType<typeof prepareClipMidiShiftTransaction> | undefined;
            let reentrantResult: boolean | undefined;
            mocks.set.mockImplementationOnce((nextState: MidiStoreState | null): void => {
                mocks.state.value = nextState;
                if (!transaction) {
                    throw new Error('Expected a prepared transaction');
                }
                if (reentrantOperation === 'apply') {
                    reentrantResult = transaction.apply();
                    return;
                }
                reentrantResult = transaction.revert();
            });
            const preparedTransaction = prepareClipMidiShiftTransaction({
                clipId: 'target',
                beatDelta: 1,
            });
            transaction = preparedTransaction;

            const outerApplyResult = preparedTransaction.apply();
            const publishedState = requireState();
            const laterRevertResult = preparedTransaction.revert();
            const laterApplyResult = preparedTransaction.apply();

            expect(outerApplyResult).toBe(false);
            expect(reentrantResult).toBe(false);
            expect(laterRevertResult).toBe(false);
            expect(laterApplyResult).toBe(false);
            expect(mocks.state.value).toBe(publishedState);
            expect(mocks.set).toHaveBeenCalledTimes(1);
        }
    );

    it('refuses a stale revert by exact applied-state identity and closes the handle', () => {
        const preparedState = midiState({
            notesByClipId: { target: [note(1)] },
            ccByClipId: { target: [cc(2)] },
        });
        mocks.state.value = preparedState;
        const transaction = prepareClipMidiShiftTransaction({
            clipId: 'target',
            beatDelta: 1,
        });

        expect(transaction.apply()).toBe(true);
        const appliedState = requireState();
        const interveningState = midiState({
            notesByClipId: { target: [note(9)] },
        });
        mocks.state.value = interveningState;

        expect(transaction.revert()).toBe(false);
        expect(mocks.state.value).toBe(interveningState);
        expect(mocks.set).toHaveBeenCalledTimes(1);

        mocks.state.value = appliedState;
        expect(transaction.revert()).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(1);
    });

    it('closes without a second write when apply publication throws', () => {
        const preparedState = midiState({
            notesByClipId: { target: [note(1)] },
        });
        const failure = new Error('apply publication failed');
        mocks.state.value = preparedState;
        mocks.set.mockImplementationOnce(() => {
            throw failure;
        });
        const transaction = prepareClipMidiShiftTransaction({
            clipId: 'target',
            beatDelta: 1,
        });

        expect(() => transaction.apply()).toThrow(failure);
        expect(mocks.state.value).toBe(preparedState);
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(1);
    });

    it('closes when apply publication does not expose the applied state', () => {
        const preparedState = midiState({
            notesByClipId: { target: [note(1)] },
        });
        mocks.state.value = preparedState;
        mocks.set.mockImplementationOnce(() => undefined);
        const transaction = prepareClipMidiShiftTransaction({
            clipId: 'target',
            beatDelta: 1,
        });

        expect(transaction.apply()).toBe(false);
        expect(mocks.state.value).toBe(preparedState);
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(1);
    });

    it('closes without a second write when revert publication throws', () => {
        const preparedState = midiState({
            notesByClipId: { target: [note(1)] },
        });
        const failure = new Error('revert publication failed');
        mocks.state.value = preparedState;
        const transaction = prepareClipMidiShiftTransaction({
            clipId: 'target',
            beatDelta: 1,
        });

        expect(transaction.apply()).toBe(true);
        const appliedState = requireState();
        mocks.set.mockImplementationOnce(() => {
            throw failure;
        });

        expect(() => transaction.revert()).toThrow(failure);
        expect(mocks.state.value).toBe(appliedState);
        expect(transaction.revert()).toBe(false);
        expect(transaction.apply()).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(2);
    });

    it('closes when revert publication does not expose the captured state', () => {
        const preparedState = midiState({
            notesByClipId: { target: [note(1)] },
        });
        mocks.state.value = preparedState;
        const transaction = prepareClipMidiShiftTransaction({
            clipId: 'target',
            beatDelta: 1,
        });

        expect(transaction.apply()).toBe(true);
        const appliedState = requireState();
        mocks.set.mockImplementationOnce(() => undefined);

        expect(transaction.revert()).toBe(false);
        expect(mocks.state.value).toBe(appliedState);
        expect(transaction.revert()).toBe(false);
        expect(transaction.apply()).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(2);
    });
});
