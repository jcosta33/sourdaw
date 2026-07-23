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

const { prepareMidiTimeShiftTransaction } = await import('../prepareMidiTimeShiftTransaction');

type PrepareInput = Parameters<typeof prepareMidiTimeShiftTransaction>[0];
type OwnerSnapshot = PrepareInput['owners'][number];
type ClipSnapshot = OwnerSnapshot['clips'][number];

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
        controller: 74,
        value: 64,
        beat,
        channel: 2,
    };
}

function pitchBend(beat: number, id = 'pitch-bend-1'): MidiPitchBend {
    return {
        id,
        value: 0.5,
        beat,
        channel: 3,
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

function clip(clipId: string, startBeat = 4, endBeat = 12, midiOffsetBeats?: number): ClipSnapshot {
    return {
        clipId,
        startBeat,
        endBeat,
        ...(midiOffsetBeats === undefined ? {} : { midiOffsetBeats }),
    };
}

function owner(trackId: string, eligible: boolean, clips: readonly ClipSnapshot[]): OwnerSnapshot {
    return {
        trackId,
        eligible,
        clips,
    };
}

function requireState(): MidiStoreState {
    const state = mocks.state.value;
    if (!state) {
        throw new Error('Expected a MIDI store state');
    }
    return state;
}

function expectRejected(input: PrepareInput, preparedState: MidiStoreState | null): void {
    mocks.state.value = preparedState;
    mocks.set.mockClear();

    const transaction = prepareMidiTimeShiftTransaction(input);

    expect(transaction.status).toBe('rejected');
    expect(transaction.hasChanges).toBe(false);
    expect(mocks.state.value).toBe(preparedState);
    expect(transaction.apply()).toBe(false);
    expect(transaction.revert()).toBe(false);
    expect(mocks.set).not.toHaveBeenCalled();
}

function expectReadyNoChange(input: PrepareInput, preparedState: MidiStoreState): void {
    mocks.state.value = preparedState;
    mocks.set.mockClear();

    const transaction = prepareMidiTimeShiftTransaction(input);

    expect(transaction.status).toBe('ready');
    expect(transaction.hasChanges).toBe(false);
    expect(mocks.state.value).toBe(preparedState);
    expect(transaction.apply()).toBe(false);
    expect(transaction.revert()).toBe(false);
    expect(mocks.set).not.toHaveBeenCalled();
}

describe('prepareMidiTimeShiftTransaction', () => {
    beforeEach(() => {
        mocks.state.value = null;
        mocks.set.mockReset();
        mocks.set.mockImplementation((nextState: MidiStoreState | null): void => {
            mocks.state.value = nextState;
        });
    });

    it('prepares without effects and shifts only eligible straddler events at the media window', () => {
        const beforeWindowNote = { ...note(5, 'before-note'), probability: 80, pressure: 0.25 };
        const shiftedNote = {
            ...note(6, 'shifted-note'),
            pitch: 72,
            duration: 2,
            velocity: 81,
            slide: 0.5,
            channel: 7,
        };
        const shiftedCc = { ...cc(6), controller: 11, value: 96, channel: 4 };
        const shiftedPitchBend = { ...pitchBend(7), value: -0.75, channel: 5 };
        const dormantNotes = [note(6, 'dormant-note')];
        const movedNotes = [note(20, 'moved-note')];
        const endedCcs = [cc(20, 'ended-cc')];
        const unrelatedPitchBends = [pitchBend(20, 'unrelated-pitch-bend')];
        const migratedAbsoluteNoteClipIds = ['straddler', 'dormant'];
        const futureMetadata = { retained: true };
        const preparedState = {
            ...midiState({
                notesByClipId: {
                    straddler: [beforeWindowNote, shiftedNote],
                    dormant: dormantNotes,
                    moved: movedNotes,
                },
                ccByClipId: {
                    straddler: [shiftedCc],
                    ended: endedCcs,
                },
                pitchBendByClipId: {
                    straddler: [shiftedPitchBend],
                    unrelated: unrelatedPitchBends,
                },
                migratedAbsoluteNoteClipIds,
            }),
            futureMetadata,
        };
        mocks.state.value = preparedState;

        const transaction = prepareMidiTimeShiftTransaction({
            atBeat: 8,
            beatDelta: -10,
            owners: [
                owner('track-eligible', true, [
                    clip('straddler', 4, 12, 2),
                    clip('moved', 8, 16),
                    clip('ended', 0, 8),
                    clip('unrelated', 0, 8),
                    clip('empty-data', 2, 10),
                ]),
                owner('track-vca', false, [clip('dormant', 4, 12)]),
            ],
        });

        expect(transaction.status).toBe('ready');
        expect(transaction.hasChanges).toBe(true);
        expect(mocks.state.value).toBe(preparedState);
        expect(mocks.set).not.toHaveBeenCalled();
        expect(preparedState.notesByClipId.straddler?.map(({ startBeat }) => startBeat)).toEqual([5, 6]);

        expect(transaction.apply()).toBe(true);
        expect(mocks.set).toHaveBeenCalledTimes(1);
        const appliedState = requireState();
        expect(appliedState).not.toBe(preparedState);
        expect(appliedState.notesByClipId.straddler).toEqual([beforeWindowNote, { ...shiftedNote, startBeat: -4 }]);
        expect(appliedState.notesByClipId.straddler?.[0]).toBe(beforeWindowNote);
        expect(appliedState.notesByClipId.straddler?.[1]).not.toBe(shiftedNote);
        expect(appliedState.notesByClipId).not.toBe(preparedState.notesByClipId);
        expect(appliedState.ccByClipId.straddler).toEqual([{ ...shiftedCc, beat: -4 }]);
        expect(appliedState.ccByClipId).not.toBe(preparedState.ccByClipId);
        expect(appliedState.pitchBendByClipId.straddler).toEqual([{ ...shiftedPitchBend, beat: -3 }]);
        expect(appliedState.notesByClipId.dormant).toBe(dormantNotes);
        expect(appliedState.notesByClipId.moved).toBe(movedNotes);
        expect(appliedState.ccByClipId.ended).toBe(endedCcs);
        expect(appliedState.pitchBendByClipId.unrelated).toBe(unrelatedPitchBends);
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

    it('uses the inclusive clip-relative window with an optional MIDI offset for all event families', () => {
        const beforeNote = note(5.999, 'before-note');
        const boundaryNote = note(6, 'boundary-note');
        const beforeCc = cc(5.999, 'before-cc');
        const boundaryCc = cc(6, 'boundary-cc');
        const beforePitchBend = pitchBend(5.999, 'before-pitch-bend');
        const boundaryPitchBend = pitchBend(6, 'boundary-pitch-bend');
        const preparedState = midiState({
            notesByClipId: { target: [beforeNote, boundaryNote] },
            ccByClipId: { target: [beforeCc, boundaryCc] },
            pitchBendByClipId: { target: [beforePitchBend, boundaryPitchBend] },
        });
        mocks.state.value = preparedState;

        const transaction = prepareMidiTimeShiftTransaction({
            atBeat: 8,
            beatDelta: 2,
            owners: [owner('track-1', true, [clip('target', 4, 12, 2)])],
        });

        expect(transaction.apply()).toBe(true);
        const appliedState = requireState();
        expect(appliedState.notesByClipId.target?.map(({ startBeat }) => startBeat)).toEqual([5.999, 8]);
        expect(appliedState.ccByClipId.target?.map(({ beat }) => beat)).toEqual([5.999, 8]);
        expect(appliedState.pitchBendByClipId.target?.map(({ beat }) => beat)).toEqual([5.999, 8]);
        expect(appliedState.notesByClipId.target?.[0]).toBe(beforeNote);
        expect(appliedState.ccByClipId.target?.[0]).toBe(beforeCc);
        expect(appliedState.pitchBendByClipId.target?.[0]).toBe(beforePitchBend);
    });

    it.each([
        {
            name: 'an unknown notes clip',
            state: midiState({ notesByClipId: { unknown: [note(1)] } }),
        },
        {
            name: 'an unknown CC clip',
            state: midiState({ ccByClipId: { unknown: [cc(1)] } }),
        },
        {
            name: 'an unknown pitch-bend clip',
            state: midiState({ pitchBendByClipId: { unknown: [pitchBend(1)] } }),
        },
        {
            name: 'an unknown empty collection',
            state: midiState({ notesByClipId: { unknown: [] } }),
        },
    ])('rejects $name rather than applying a valid subset', ({ state }) => {
        expectRejected(
            {
                atBeat: 4,
                beatDelta: 1,
                owners: [owner('track-1', true, [clip('known', 0, 8)])],
            },
            state
        );
    });

    it.each([
        {
            name: 'an empty track id',
            owners: [owner('', true, [clip('target')])],
        },
        {
            name: 'a whitespace-only track id',
            owners: [owner('   ', true, [clip('target')])],
        },
        {
            name: 'a duplicate track owner',
            owners: [owner('track-1', true, [clip('target')]), owner('track-1', false, [clip('other')])],
        },
        {
            name: 'a duplicate clip within one owner',
            owners: [owner('track-1', true, [clip('target'), clip('target')])],
        },
        {
            name: 'contradictory clip owners',
            owners: [owner('track-1', true, [clip('target')]), owner('track-2', false, [clip('target')])],
        },
        {
            name: 'an empty clip id',
            owners: [owner('track-1', true, [clip('')])],
        },
        {
            name: 'a whitespace-only clip id',
            owners: [owner('track-1', true, [clip('   ')])],
        },
        {
            name: 'a non-finite clip start',
            owners: [owner('track-1', true, [clip('target', Number.NaN, 8)])],
        },
        {
            name: 'a non-finite clip end',
            owners: [owner('track-1', true, [clip('target', 0, Number.POSITIVE_INFINITY)])],
        },
        {
            name: 'an empty clip range',
            owners: [owner('track-1', true, [clip('target', 4, 4)])],
        },
        {
            name: 'a reversed clip range',
            owners: [owner('track-1', true, [clip('target', 5, 4)])],
        },
        {
            name: 'a non-finite MIDI offset',
            owners: [owner('track-1', true, [clip('target', 0, 8, Number.NEGATIVE_INFINITY)])],
        },
    ])('rejects $name before writes', ({ owners }) => {
        const preparedState = midiState({ notesByClipId: { target: [note(4)] } });

        expectRejected(
            {
                atBeat: 4,
                beatDelta: 1,
                owners,
            },
            preparedState
        );
    });

    it('rejects a non-boolean owner eligibility before writes', () => {
        const preparedState = midiState({ notesByClipId: { target: [note(4)] } });
        const owners = [
            {
                trackId: 'track-1',
                eligible: 'yes',
                clips: [clip('target')],
            },
        ];

        // @ts-expect-error -- exercise runtime validation for an invalid eligibility value.
        expectRejected({ atBeat: 4, beatDelta: 1, owners }, preparedState);
    });

    it.each([
        { atBeat: Number.NaN, beatDelta: 1 },
        { atBeat: Number.POSITIVE_INFINITY, beatDelta: 1 },
        { atBeat: -1, beatDelta: 1 },
        { atBeat: 4, beatDelta: Number.NaN },
        { atBeat: 4, beatDelta: Number.POSITIVE_INFINITY },
        { atBeat: 4, beatDelta: Number.NEGATIVE_INFINITY },
    ])('rejects invalid global timing input $atBeat/$beatDelta', ({ atBeat, beatDelta }) => {
        const preparedState = midiState({ notesByClipId: { target: [note(4)] } });

        expectRejected(
            {
                atBeat,
                beatDelta,
                owners: [owner('track-1', true, [clip('target', 0, 8)])],
            },
            preparedState
        );
    });

    it('rejects missing MIDI owner state', () => {
        expectRejected(
            {
                atBeat: 4,
                beatDelta: 1,
                owners: [],
            },
            null
        );
    });

    it('rejects a non-finite computed media window before writes', () => {
        const preparedState = midiState({ notesByClipId: { target: [note(4)] } });

        expectRejected(
            {
                atBeat: 1e308,
                beatDelta: 1,
                owners: [owner('track-1', true, [clip('target', -1e308, Number.MAX_VALUE, 1e308)])],
            },
            preparedState
        );
    });

    it.each([
        {
            name: 'note',
            state: midiState({ notesByClipId: { target: [note(Number.MAX_VALUE)] } }),
        },
        {
            name: 'CC',
            state: midiState({ ccByClipId: { target: [cc(Number.MAX_VALUE)] } }),
        },
        {
            name: 'pitch bend',
            state: midiState({ pitchBendByClipId: { target: [pitchBend(Number.MAX_VALUE)] } }),
        },
    ])('rejects a non-finite shifted $name beat before writes', ({ state }) => {
        expectRejected(
            {
                atBeat: 0,
                beatDelta: Number.MAX_VALUE,
                owners: [owner('track-1', true, [clip('target', -1, 1)])],
            },
            state
        );
    });

    it('reports ready no-change for zero delta after validating the complete snapshot', () => {
        const preparedState = midiState({
            notesByClipId: { target: [note(4)] },
            ccByClipId: { target: [cc(4)] },
            pitchBendByClipId: { target: [pitchBend(4)] },
        });

        expectReadyNoChange(
            {
                atBeat: 4,
                beatDelta: 0,
                owners: [owner('track-1', true, [clip('target', 0, 8)])],
            },
            preparedState
        );

        expectRejected(
            {
                atBeat: 4,
                beatDelta: 0,
                owners: [],
            },
            preparedState
        );
    });

    it('reports ready no-change for empty maps and snapshot clips without MIDI data', () => {
        const emptyState = midiState();

        expectReadyNoChange(
            {
                atBeat: 4,
                beatDelta: 2,
                owners: [],
            },
            emptyState
        );
        expectReadyNoChange(
            {
                atBeat: 4,
                beatDelta: 2,
                owners: [owner('track-1', true, [clip('without-data', 0, 8)])],
            },
            emptyState
        );
    });

    it.each([
        {
            name: 'an ineligible owner',
            state: midiState({ notesByClipId: { target: [note(4)] } }),
            input: {
                atBeat: 4,
                beatDelta: 2,
                owners: [owner('track-vca', false, [clip('target', 0, 8)])],
            },
        },
        {
            name: 'a clip starting at the global boundary',
            state: midiState({ notesByClipId: { target: [note(4)] } }),
            input: {
                atBeat: 4,
                beatDelta: 2,
                owners: [owner('track-1', true, [clip('target', 4, 8)])],
            },
        },
        {
            name: 'a clip ending at the global boundary',
            state: midiState({ ccByClipId: { target: [cc(4)] } }),
            input: {
                atBeat: 4,
                beatDelta: 2,
                owners: [owner('track-1', true, [clip('target', 0, 4)])],
            },
        },
        {
            name: 'events before the media window',
            state: midiState({ pitchBendByClipId: { target: [pitchBend(3)] } }),
            input: {
                atBeat: 4,
                beatDelta: 2,
                owners: [owner('track-1', true, [clip('target', 0, 8)])],
            },
        },
        {
            name: 'a finite rounded-equal shifted beat',
            state: midiState({ notesByClipId: { target: [note(Number.MAX_VALUE)] } }),
            input: {
                atBeat: 0,
                beatDelta: Number.MIN_VALUE,
                owners: [owner('track-1', true, [clip('target', -1, 1)])],
            },
        },
    ])('reports ready no-change for $name', ({ state, input }) => {
        expectReadyNoChange(input, state);
    });

    it('refuses stale apply by exact captured identity and closes the handle', () => {
        const preparedState = midiState({ notesByClipId: { target: [note(4)] } });
        mocks.state.value = preparedState;
        const transaction = prepareMidiTimeShiftTransaction({
            atBeat: 4,
            beatDelta: 2,
            owners: [owner('track-1', true, [clip('target', 0, 8)])],
        });
        const equalStateWithNewIdentity = { ...preparedState };
        mocks.state.value = equalStateWithNewIdentity;

        expect(transaction.apply()).toBe(false);
        expect(mocks.state.value).toBe(equalStateWithNewIdentity);
        expect(mocks.set).not.toHaveBeenCalled();

        mocks.state.value = preparedState;
        expect(transaction.apply()).toBe(false);
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('closes after an out-of-order revert or a repeated apply without an extra write', () => {
        const preparedState = midiState({ notesByClipId: { target: [note(4)] } });
        mocks.state.value = preparedState;
        const outOfOrder = prepareMidiTimeShiftTransaction({
            atBeat: 4,
            beatDelta: 2,
            owners: [owner('track-1', true, [clip('target', 0, 8)])],
        });

        expect(outOfOrder.revert()).toBe(false);
        expect(outOfOrder.apply()).toBe(false);
        expect(mocks.set).not.toHaveBeenCalled();

        mocks.state.value = preparedState;
        const repeated = prepareMidiTimeShiftTransaction({
            atBeat: 4,
            beatDelta: 2,
            owners: [owner('track-1', true, [clip('target', 0, 8)])],
        });
        expect(repeated.apply()).toBe(true);
        const appliedState = requireState();
        expect(repeated.apply()).toBe(false);
        expect(repeated.revert()).toBe(false);
        expect(mocks.state.value).toBe(appliedState);
        expect(mocks.set).toHaveBeenCalledTimes(1);
    });

    it('refuses stale revert by exact applied identity and closes the handle', () => {
        const preparedState = midiState({ notesByClipId: { target: [note(4)] } });
        mocks.state.value = preparedState;
        const transaction = prepareMidiTimeShiftTransaction({
            atBeat: 4,
            beatDelta: 2,
            owners: [owner('track-1', true, [clip('target', 0, 8)])],
        });

        expect(transaction.apply()).toBe(true);
        const appliedState = requireState();
        const interveningState = midiState({ notesByClipId: { target: [note(12)] } });
        mocks.state.value = interveningState;

        expect(transaction.revert()).toBe(false);
        expect(mocks.state.value).toBe(interveningState);
        expect(mocks.set).toHaveBeenCalledTimes(1);

        mocks.state.value = appliedState;
        expect(transaction.revert()).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(1);
    });

    it.each(['apply', 'revert'] as const)(
        'fails closed under reentrant %s during apply publication',
        (reentrantOperation) => {
            const preparedState = midiState({ notesByClipId: { target: [note(4)] } });
            mocks.state.value = preparedState;
            let transaction: ReturnType<typeof prepareMidiTimeShiftTransaction> | undefined;
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
            transaction = prepareMidiTimeShiftTransaction({
                atBeat: 4,
                beatDelta: 2,
                owners: [owner('track-1', true, [clip('target', 0, 8)])],
            });

            expect(transaction.apply()).toBe(false);
            const publishedState = requireState();
            expect(reentrantResult).toBe(false);
            expect(transaction.apply()).toBe(false);
            expect(transaction.revert()).toBe(false);
            expect(mocks.state.value).toBe(publishedState);
            expect(mocks.set).toHaveBeenCalledTimes(1);
        }
    );

    it.each(['apply', 'revert'] as const)(
        'fails closed under reentrant %s during revert publication',
        (reentrantOperation) => {
            const preparedState = midiState({ notesByClipId: { target: [note(4)] } });
            mocks.state.value = preparedState;
            const transaction = prepareMidiTimeShiftTransaction({
                atBeat: 4,
                beatDelta: 2,
                owners: [owner('track-1', true, [clip('target', 0, 8)])],
            });
            expect(transaction.apply()).toBe(true);
            let reentrantResult: boolean | undefined;
            mocks.set.mockImplementationOnce((nextState: MidiStoreState | null): void => {
                mocks.state.value = nextState;
                if (reentrantOperation === 'apply') {
                    reentrantResult = transaction.apply();
                    return;
                }
                reentrantResult = transaction.revert();
            });

            expect(transaction.revert()).toBe(false);
            expect(reentrantResult).toBe(false);
            expect(mocks.state.value).toBe(preparedState);
            expect(transaction.apply()).toBe(false);
            expect(transaction.revert()).toBe(false);
            expect(mocks.set).toHaveBeenCalledTimes(2);
        }
    );

    it('closes when apply publication throws or does not retain the prepared identity', () => {
        const preparedState = midiState({ notesByClipId: { target: [note(4)] } });
        const failure = new Error('apply publication failed');
        mocks.state.value = preparedState;
        mocks.set.mockImplementationOnce(() => {
            throw failure;
        });
        const throwingTransaction = prepareMidiTimeShiftTransaction({
            atBeat: 4,
            beatDelta: 2,
            owners: [owner('track-1', true, [clip('target', 0, 8)])],
        });

        expect(() => throwingTransaction.apply()).toThrow(failure);
        expect(mocks.state.value).toBe(preparedState);
        expect(throwingTransaction.apply()).toBe(false);
        expect(throwingTransaction.revert()).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(1);

        mocks.set.mockClear();
        mocks.set.mockImplementationOnce(() => undefined);
        const hiddenPublication = prepareMidiTimeShiftTransaction({
            atBeat: 4,
            beatDelta: 2,
            owners: [owner('track-1', true, [clip('target', 0, 8)])],
        });

        expect(hiddenPublication.apply()).toBe(false);
        expect(mocks.state.value).toBe(preparedState);
        expect(hiddenPublication.apply()).toBe(false);
        expect(hiddenPublication.revert()).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(1);
    });

    it('closes when revert publication throws or does not retain the captured identity', () => {
        const preparedState = midiState({ notesByClipId: { target: [note(4)] } });
        mocks.state.value = preparedState;
        const throwingTransaction = prepareMidiTimeShiftTransaction({
            atBeat: 4,
            beatDelta: 2,
            owners: [owner('track-1', true, [clip('target', 0, 8)])],
        });
        expect(throwingTransaction.apply()).toBe(true);
        const appliedState = requireState();
        const failure = new Error('revert publication failed');
        mocks.set.mockImplementationOnce(() => {
            throw failure;
        });

        expect(() => throwingTransaction.revert()).toThrow(failure);
        expect(mocks.state.value).toBe(appliedState);
        expect(throwingTransaction.revert()).toBe(false);
        expect(throwingTransaction.apply()).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(2);

        mocks.state.value = preparedState;
        mocks.set.mockClear();
        mocks.set.mockImplementation((nextState: MidiStoreState | null): void => {
            mocks.state.value = nextState;
        });
        const hiddenPublication = prepareMidiTimeShiftTransaction({
            atBeat: 4,
            beatDelta: 2,
            owners: [owner('track-1', true, [clip('target', 0, 8)])],
        });
        expect(hiddenPublication.apply()).toBe(true);
        const hiddenAppliedState = requireState();
        mocks.set.mockImplementationOnce(() => undefined);

        expect(hiddenPublication.revert()).toBe(false);
        expect(mocks.state.value).toBe(hiddenAppliedState);
        expect(hiddenPublication.revert()).toBe(false);
        expect(hiddenPublication.apply()).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(2);
    });
});
