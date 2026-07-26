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
const { prepareMidiTimeStateRestore } = await import('../prepareMidiTimeStateRestore');

type RestorePlan = NonNullable<ReturnType<typeof prepareMidiGlobalTimeTransaction>['inversePlan']>;

type EncodedObjectEntry = {
    key: string;
    value: unknown;
};

type EncodedObjectNode = {
    type: 'object';
    prototype: string;
    entries: EncodedObjectEntry[];
};

type EncodedArrayEntry = {
    index: number;
    value: unknown;
};

type EncodedArrayNode = {
    type: 'array';
    length: number;
    entries: EncodedArrayEntry[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isEncodedObjectEntry(value: unknown): value is EncodedObjectEntry {
    return isRecord(value) && typeof value.key === 'string' && Object.hasOwn(value, 'value');
}

function isEncodedObject(value: unknown): value is EncodedObjectNode {
    if (
        !isRecord(value) ||
        value.type !== 'object' ||
        typeof value.prototype !== 'string' ||
        !Array.isArray(value.entries)
    ) {
        return false;
    }

    return value.entries.every(isEncodedObjectEntry);
}

function requireEncodedObject(value: unknown): EncodedObjectNode {
    if (!isEncodedObject(value)) {
        throw new Error('Expected encoded object node');
    }

    return value;
}

function isEncodedArrayEntry(value: unknown): value is EncodedArrayEntry {
    return isRecord(value) && typeof value.index === 'number' && Object.hasOwn(value, 'value');
}

function isEncodedArray(value: unknown): value is EncodedArrayNode {
    if (
        !isRecord(value) ||
        value.type !== 'array' ||
        typeof value.length !== 'number' ||
        !Array.isArray(value.entries)
    ) {
        return false;
    }

    return value.entries.every(isEncodedArrayEntry);
}

function requireEncodedArray(value: unknown): EncodedArrayNode {
    if (!isEncodedArray(value)) {
        throw new Error('Expected encoded array node');
    }

    return value;
}

function requireEncodedObjectEntry(node: EncodedObjectNode, key: string): EncodedObjectEntry {
    const entry = node.entries.find((candidate) => candidate.key === key);
    if (!entry) {
        throw new Error(`Expected encoded object entry ${key}`);
    }

    return entry;
}

function makeDormantNotesSparse(plan: RestorePlan): void {
    const replacementState = requireEncodedObject(plan.replacement);
    const notesByClipId = requireEncodedObject(requireEncodedObjectEntry(replacementState, 'notesByClipId').value);
    const dormantNotes = requireEncodedArray(requireEncodedObjectEntry(notesByClipId, 'dormant').value);
    const noteEntry = dormantNotes.entries[0];
    if (!noteEntry) {
        throw new Error('Expected encoded dormant note');
    }

    dormantNotes.length = 3;
    noteEntry.index = 2;
}

function sparseArray<Row>(length: number, index: number, value: Row): Row[] {
    const rows: Row[] = [];
    rows.length = length;
    rows[index] = value;
    return rows;
}

function note(overrides: Partial<MidiNote> = {}): MidiNote {
    return {
        id: 'note-1',
        pitch: 60,
        startBeat: 1,
        duration: 1,
        velocity: 100,
        ...overrides,
    };
}

function cc(overrides: Partial<MidiCC> = {}): MidiCC {
    return {
        id: 'cc-1',
        controller: 1,
        value: 64,
        beat: 1,
        channel: 0,
        ...overrides,
    };
}

function pitchBend(overrides: Partial<MidiPitchBend> = {}): MidiPitchBend {
    return {
        id: 'bend-1',
        value: 0,
        beat: 1,
        channel: 0,
        ...overrides,
    };
}

function losslessState(): MidiStoreState {
    const dormantNote = note({
        id: 'dormant-note',
        pitch: -0,
        pressure: undefined,
    });

    return {
        probabilitySeed: -0,
        notesByClipId: {
            active: [note({ id: 'active-note' })],
            dormant: sparseArray(3, 2, dormantNote),
        },
        ccByClipId: {
            dormant: sparseArray(4, 1, cc({ value: -0 })),
        },
        pitchBendByClipId: {
            dormant: sparseArray(5, 3, pitchBend({ value: -0 })),
        },
        migratedAbsoluteNoteClipIds: sparseArray(4, 2, 'dormant'),
    };
}

function transactionSourceState(): MidiStoreState {
    const currentState = losslessState();
    currentState.notesByClipId.dormant = [
        note({
            id: 'dormant-note',
            pitch: -0,
            pressure: undefined,
        }),
    ];
    return currentState;
}

function requireState(): MidiStoreState {
    const currentState = mocks.state.value;
    if (!currentState) {
        throw new Error('Expected MIDI state');
    }

    return currentState;
}

function prepareSerializedInversePlan(): {
    plan: RestorePlan;
    preparedPostState: MidiStoreState;
} {
    mocks.state.value = transactionSourceState();
    const transaction = prepareMidiGlobalTimeTransaction({
        operation: {
            type: 'insert',
            atBeat: 1,
            durationBeats: 2,
        },
        owners: [
            {
                trackId: 'track-active',
                eligible: true,
                clips: [{ clipId: 'active', startBeat: 0, endBeat: 8 }],
            },
            {
                trackId: 'track-dormant',
                eligible: false,
                clips: [{ clipId: 'dormant', startBeat: 0, endBeat: 8 }],
            },
        ],
    });

    expect(transaction.status).toBe('ready');
    expect(transaction.hasChanges).toBe(true);
    expect(transaction.inversePlan).not.toBeNull();
    expect(transaction.apply()).toBe(true);

    const serializedPlan: unknown = JSON.parse(JSON.stringify(transaction.inversePlan));
    if (!serializedPlan) {
        throw new Error('Expected serialized inverse plan');
    }

    return {
        plan: serializedPlan as RestorePlan,
        preparedPostState: requireState(),
    };
}

function expectSparseArray<Row>(rows: Row[], length: number, occupiedIndex: number): void {
    expect(rows).toHaveLength(length);
    for (let index = 0; index < length; index += 1) {
        expect(Object.hasOwn(rows, index)).toBe(index === occupiedIndex);
    }
}

function expectLosslessState(state: MidiStoreState): void {
    expect(Object.is(state.probabilitySeed, -0)).toBe(true);

    const notes = state.notesByClipId.dormant;
    const ccs = state.ccByClipId.dormant;
    const pitchBends = state.pitchBendByClipId.dormant;
    const migratedIds = state.migratedAbsoluteNoteClipIds;
    if (!notes || !ccs || !pitchBends || !migratedIds) {
        throw new Error('Expected complete dormant MIDI state');
    }

    expectSparseArray(notes, 3, 2);
    expectSparseArray(ccs, 4, 1);
    expectSparseArray(pitchBends, 5, 3);
    expectSparseArray(migratedIds, 4, 2);

    const restoredNote = notes[2];
    const restoredCc = ccs[1];
    const restoredPitchBend = pitchBends[3];
    if (!restoredNote || !restoredCc || !restoredPitchBend) {
        throw new Error('Expected occupied sparse MIDI entries');
    }

    expect(Object.hasOwn(restoredNote, 'pressure')).toBe(true);
    expect(restoredNote.pressure).toBeUndefined();
    expect(Object.is(restoredNote.pitch, -0)).toBe(true);
    expect(Object.is(restoredCc.value, -0)).toBe(true);
    expect(Object.is(restoredPitchBend.value, -0)).toBe(true);
}

function expectRejectedWithoutWrite(plan: unknown, currentState: MidiStoreState | null): void {
    mocks.state.value = currentState;
    const transaction = prepareMidiTimeStateRestore(plan);

    expect(transaction.status).toBe('rejected');
    expect(transaction.hasChanges).toBe(false);
    expect(transaction.apply()).toBe(false);
    expect(transaction.revert()).toBe(false);
    expect(mocks.state.value).toBe(currentState);
    expect(mocks.set).not.toHaveBeenCalled();
}

describe('prepareMidiTimeStateRestore', () => {
    beforeEach(() => {
        mocks.state.value = losslessState();
        mocks.set.mockReset();
        mocks.set.mockImplementation((nextState: MidiStoreState | null): void => {
            mocks.state.value = nextState;
        });
    });

    it('round-trips the complete inverse plan through JSON and restores every accepted MIDI value exactly', () => {
        const { plan, preparedPostState } = prepareSerializedInversePlan();
        makeDormantNotesSparse(plan);
        const sparseSerializedPlan: unknown = JSON.parse(JSON.stringify(plan));
        mocks.set.mockClear();

        const transaction = prepareMidiTimeStateRestore(sparseSerializedPlan);

        expect(transaction.status).toBe('ready');
        expect(transaction.hasChanges).toBe(true);
        expect(mocks.state.value).toBe(preparedPostState);
        expect(mocks.set).not.toHaveBeenCalled();

        expect(transaction.apply()).toBe(true);
        expectLosslessState(requireState());

        expect(transaction.revert()).toBe(true);
        expect(mocks.state.value).toBe(preparedPostState);
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(2);
    });

    it('validates without mutating a supplied serialized plan', () => {
        const { plan, preparedPostState } = prepareSerializedInversePlan();
        const originalPlan = structuredClone(plan);
        mocks.set.mockClear();

        const transaction = prepareMidiTimeStateRestore(plan);

        expect(transaction.status).toBe('ready');
        expect(plan).toEqual(originalPlan);
        expect(mocks.state.value).toBe(preparedPostState);
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('accepts an equal expected and replacement snapshot without writing', () => {
        const { plan, preparedPostState } = prepareSerializedInversePlan();
        const equalPlan = structuredClone(plan);
        equalPlan.replacement = structuredClone(equalPlan.expected);
        mocks.set.mockClear();

        const transaction = prepareMidiTimeStateRestore(equalPlan);

        expect(transaction.status).toBe('ready');
        expect(transaction.hasChanges).toBe(false);
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
        expect(mocks.state.value).toBe(preparedPostState);
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('rejects a stale expected state without overwriting a foreign edit', () => {
        const { plan } = prepareSerializedInversePlan();
        const foreignState = losslessState();
        foreignState.notesByClipId.active = [note({ id: 'foreign-note', startBeat: 20 })];
        mocks.set.mockClear();

        expectRejectedWithoutWrite(plan, foreignState);
    });

    it('closes when the captured current state is mutated in place before apply', () => {
        const { plan, preparedPostState } = prepareSerializedInversePlan();
        mocks.set.mockClear();
        const transaction = prepareMidiTimeStateRestore(plan);
        preparedPostState.notesByClipId.active![0]!.startBeat = 99;

        expect(transaction.apply()).toBe(false);
        expect(mocks.state.value).toBe(preparedPostState);
        expect(mocks.set).not.toHaveBeenCalled();
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
    });

    it('closes when the published replacement is mutated in place before revert', () => {
        const { plan } = prepareSerializedInversePlan();
        mocks.set.mockClear();
        const transaction = prepareMidiTimeStateRestore(plan);

        expect(transaction.apply()).toBe(true);
        const replacementState = requireState();
        replacementState.notesByClipId.active![0]!.startBeat = 99;

        expect(transaction.revert()).toBe(false);
        expect(mocks.state.value).toBe(replacementState);
        expect(mocks.set).toHaveBeenCalledTimes(1);
        expect(transaction.revert()).toBe(false);
    });

    it('closes after a stale replacement reference blocks revert', () => {
        const { plan } = prepareSerializedInversePlan();
        mocks.set.mockClear();
        const transaction = prepareMidiTimeStateRestore(plan);
        expect(transaction.apply()).toBe(true);
        const foreignState = losslessState();
        mocks.state.value = foreignState;

        expect(transaction.revert()).toBe(false);
        expect(mocks.state.value).toBe(foreignState);
        expect(mocks.set).toHaveBeenCalledTimes(1);
    });

    it('closes after an out-of-order revert or a repeated apply', () => {
        const first = prepareSerializedInversePlan();
        mocks.set.mockClear();
        const outOfOrder = prepareMidiTimeStateRestore(first.plan);

        expect(outOfOrder.revert()).toBe(false);
        expect(outOfOrder.apply()).toBe(false);
        expect(mocks.set).not.toHaveBeenCalled();

        mocks.state.value = first.preparedPostState;
        const repeated = prepareMidiTimeStateRestore(first.plan);
        expect(repeated.apply()).toBe(true);
        expect(repeated.apply()).toBe(false);
        expect(repeated.revert()).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(1);
    });

    it('keeps setter failures visible and closes the handle', () => {
        const { plan } = prepareSerializedInversePlan();
        const publicationError = new Error('restore publication failed');
        mocks.set.mockReset();
        mocks.set.mockImplementationOnce((nextState: MidiStoreState | null): void => {
            mocks.state.value = nextState;
            throw publicationError;
        });
        const transaction = prepareMidiTimeStateRestore(plan);

        expect(() => transaction.apply()).toThrow(publicationError);
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(1);
    });

    it('keeps revert setter failures visible and closes the handle', () => {
        const { plan } = prepareSerializedInversePlan();
        mocks.set.mockClear();
        const transaction = prepareMidiTimeStateRestore(plan);
        expect(transaction.apply()).toBe(true);
        const publicationError = new Error('revert publication failed');
        mocks.set.mockImplementationOnce((nextState: MidiStoreState | null): void => {
            mocks.state.value = nextState;
            throw publicationError;
        });

        expect(() => transaction.revert()).toThrow(publicationError);
        expect(transaction.revert()).toBe(false);
        expect(transaction.apply()).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(2);
    });

    it('closes when a setter returns without publishing the replacement', () => {
        const { plan, preparedPostState } = prepareSerializedInversePlan();
        mocks.set.mockReset();
        mocks.set.mockImplementationOnce(() => {});
        const transaction = prepareMidiTimeStateRestore(plan);

        expect(transaction.apply()).toBe(false);
        expect(mocks.state.value).toBe(preparedPostState);
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(1);
    });

    it('keeps an outer apply revertible after a reentrant apply', () => {
        const { plan, preparedPostState } = prepareSerializedInversePlan();
        mocks.set.mockReset();
        let reentrantResult: boolean | undefined;
        const transaction = prepareMidiTimeStateRestore(plan);
        mocks.set.mockImplementationOnce((nextState: MidiStoreState | null): void => {
            mocks.state.value = nextState;
            reentrantResult = transaction.apply();
        });

        expect(transaction.apply()).toBe(true);
        expect(reentrantResult).toBe(false);
        expect(transaction.revert()).toBe(true);
        expect(mocks.state.value).toBe(preparedPostState);
        expect(transaction.apply()).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(2);
    });

    it('lets an outer revert finish after a reentrant revert', () => {
        const { plan, preparedPostState } = prepareSerializedInversePlan();
        mocks.set.mockClear();
        const transaction = prepareMidiTimeStateRestore(plan);
        expect(transaction.apply()).toBe(true);
        let reentrantResult: boolean | undefined;
        mocks.set.mockImplementationOnce((nextState: MidiStoreState | null): void => {
            mocks.state.value = nextState;
            reentrantResult = transaction.revert();
        });

        expect(transaction.revert()).toBe(true);
        expect(reentrantResult).toBe(false);
        expect(mocks.state.value).toBe(preparedPostState);
        expect(transaction.revert()).toBe(false);
        expect(transaction.apply()).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(2);
    });

    it('closes when publication is replaced by a subscriber', () => {
        const { plan } = prepareSerializedInversePlan();
        const foreignState = losslessState();
        mocks.set.mockReset();
        mocks.set.mockImplementationOnce((): void => {
            mocks.state.value = foreignState;
        });
        const transaction = prepareMidiTimeStateRestore(plan);

        expect(transaction.apply()).toBe(false);
        expect(mocks.state.value).toBe(foreignState);
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
        expect(mocks.set).toHaveBeenCalledTimes(1);
    });

    it.each([
        undefined,
        null,
        [],
        new Date(0),
        {},
        { version: 1 },
        { version: 1, expected: {}, replacement: {}, extra: true },
        { version: 2, expected: {}, replacement: {} },
    ])('rejects malformed, partial, versioned, or extra-key plans', (plan) => {
        expectRejectedWithoutWrite(plan, losslessState());
    });

    it('rejects accessor-backed and hostile plans without evaluating their values', () => {
        const expectedGetter = vi.fn(() => ({}));
        const accessorPlan = Object.defineProperties(
            {},
            {
                version: { enumerable: true, value: 1 },
                expected: { enumerable: true, get: expectedGetter },
                replacement: { enumerable: true, value: {} },
            }
        );
        const revokedPlan = Proxy.revocable({}, {});
        revokedPlan.revoke();

        expectRejectedWithoutWrite(accessorPlan, losslessState());
        expect(expectedGetter).not.toHaveBeenCalled();
        expectRejectedWithoutWrite(revokedPlan.proxy, losslessState());

        const { plan, preparedPostState } = prepareSerializedInversePlan();
        mocks.set.mockClear();
        const nestedTypeGetter = vi.fn(() => 'object');
        const accessorNodePlan = structuredClone(plan);
        Object.defineProperty(accessorNodePlan.expected, 'type', {
            enumerable: true,
            get: nestedTypeGetter,
        });
        expectRejectedWithoutWrite(accessorNodePlan, preparedPostState);
        expect(nestedTypeGetter).not.toHaveBeenCalled();

        const revokedNodePlan = structuredClone(plan);
        const revokedExpected = Proxy.revocable(revokedNodePlan.expected, {});
        revokedExpected.revoke();
        Object.defineProperty(revokedNodePlan, 'expected', {
            configurable: true,
            enumerable: true,
            value: revokedExpected.proxy,
            writable: true,
        });
        expectRejectedWithoutWrite(revokedNodePlan, preparedPostState);
    });

    it('rejects duplicate keys, duplicate or out-of-range indexes, malformed tags, cycles, and unsupported prototypes', () => {
        const { plan, preparedPostState } = prepareSerializedInversePlan();
        mocks.set.mockClear();

        const duplicateKeyPlan = structuredClone(plan);
        const duplicateKeyRoot = requireEncodedObject(duplicateKeyPlan.expected);
        const duplicateKeyEntry = duplicateKeyRoot.entries[0];
        if (!duplicateKeyEntry) {
            throw new Error('Expected encoded state entry');
        }
        duplicateKeyRoot.entries.splice(1, 0, structuredClone(duplicateKeyEntry));

        const duplicateIndexPlan = structuredClone(plan);
        const duplicateIndexRoot = requireEncodedObject(duplicateIndexPlan.replacement);
        const migratedIds = requireEncodedArray(
            requireEncodedObjectEntry(duplicateIndexRoot, 'migratedAbsoluteNoteClipIds').value
        );
        const migratedIdEntry = migratedIds.entries[0];
        if (!migratedIdEntry) {
            throw new Error('Expected encoded migrated clip id');
        }
        migratedIds.entries.push(structuredClone(migratedIdEntry));

        const outOfRangePlan = structuredClone(plan);
        const outOfRangeRoot = requireEncodedObject(outOfRangePlan.replacement);
        const outOfRangeIds = requireEncodedArray(
            requireEncodedObjectEntry(outOfRangeRoot, 'migratedAbsoluteNoteClipIds').value
        );
        const outOfRangeEntry = outOfRangeIds.entries[0];
        if (!outOfRangeEntry) {
            throw new Error('Expected encoded migrated clip id');
        }
        outOfRangeEntry.index = outOfRangeIds.length;

        const malformedTagPlan = structuredClone(plan);
        const malformedTagRoot = requireEncodedObject(malformedTagPlan.expected);
        const probabilitySeed = requireEncodedObjectEntry(malformedTagRoot, 'probabilitySeed').value;
        if (!isRecord(probabilitySeed)) {
            throw new Error('Expected encoded probability seed');
        }
        probabilitySeed.type = 'number';
        probabilitySeed.value = -0;

        const cyclicPlan = structuredClone(plan);
        const cyclicRoot = requireEncodedObject(cyclicPlan.expected);
        requireEncodedObjectEntry(cyclicRoot, 'notesByClipId').value = cyclicRoot;

        const unsupportedPrototypePlan = structuredClone(plan);
        requireEncodedObject(unsupportedPrototypePlan.replacement).prototype = 'foreign';

        for (const malformedPlan of [
            duplicateKeyPlan,
            duplicateIndexPlan,
            outOfRangePlan,
            malformedTagPlan,
            cyclicPlan,
            unsupportedPrototypePlan,
        ]) {
            expectRejectedWithoutWrite(malformedPlan, preparedPostState);
        }
    });
});
