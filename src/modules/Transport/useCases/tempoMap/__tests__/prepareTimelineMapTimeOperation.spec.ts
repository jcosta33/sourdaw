import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTempoAtBeat } from '../../../models/TempoMap';
import { getBarBeatAtPosition } from '../../../models/TimeSignatureMap';

import type { TempoChange, TempoMapStoreState } from '../../../stores/tempoMapStore';
import type { TimeSignatureChange, TimeSignatureMapStoreState } from '../../../stores/timeSignatureMapStore';

vi.mock('../../../stores/tempoMapStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../stores/tempoMapStore')>();
    const { createStore } = await import('#/infra/store/createStore');

    return { ...actual, tempoMapStore: createStore() };
});

vi.mock('../../../stores/timeSignatureMapStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../stores/timeSignatureMapStore')>();
    const { createStore } = await import('#/infra/store/createStore');

    return { ...actual, timeSignatureMapStore: createStore() };
});

const { tempoMapStore } = await import('../../../stores/tempoMapStore');
const { timeSignatureMapStore } = await import('../../../stores/timeSignatureMapStore');
const { prepareTimelineMapTimeOperation } = await import('../prepareTimelineMapTimeOperation');
const { prepareTimelineMapStateRestore } = await import('../prepareTimelineMapStateRestore');

type PrepareInput = Parameters<typeof prepareTimelineMapTimeOperation>[0];
type TimelineMapTimeOperation = PrepareInput['operation'];

type StoreObservation = {
    tempo: TempoMapStoreState | null;
    timeSignature: TimeSignatureMapStoreState | null;
};

const unsubscribers: Array<() => void> = [];

function tempoChange(id: string, beat: number, tempo = 120): TempoChange {
    return { id, beat, tempo, curve: 'instant' };
}

function timeSignatureChange(id: string, beat: number, numerator = 4): TimeSignatureChange {
    return { id, beat, numerator, denominator: 4 };
}

function tempoState(changes: TempoChange[]): TempoMapStoreState {
    return { changes };
}

function timeSignatureState(changes: TimeSignatureChange[]): TimeSignatureMapStoreState {
    return { changes };
}

function setStoreStates(tempo: TempoMapStoreState | null, timeSignature: TimeSignatureMapStoreState | null): void {
    tempoMapStore.set(tempo);
    timeSignatureMapStore.set(timeSignature);
}

function observeBothStores(): StoreObservation[] {
    const observations: StoreObservation[] = [];
    function observe(): void {
        observations.push({
            tempo: tempoMapStore.value,
            timeSignature: timeSignatureMapStore.value,
        });
    }

    unsubscribers.push(tempoMapStore.subscribe(observe));
    unsubscribers.push(timeSignatureMapStore.subscribe(observe));
    return observations;
}

function expectClosedWithoutWrite(
    operation: TimelineMapTimeOperation
): ReturnType<typeof prepareTimelineMapTimeOperation> {
    const capturedTempo = tempoMapStore.value;
    const capturedTimeSignature = timeSignatureMapStore.value;
    const tempoSet = vi.spyOn(tempoMapStore, 'set');
    const timeSignatureSet = vi.spyOn(timeSignatureMapStore, 'set');

    const transaction = prepareTimelineMapTimeOperation({ operation });

    expect(transaction.hasChanges).toBe(false);
    expect(transaction.inversePlan).toBeNull();
    expect(transaction.apply()).toBe(false);
    expect(transaction.revert()).toBe(false);
    expect(tempoMapStore.value).toBe(capturedTempo);
    expect(timeSignatureMapStore.value).toBe(capturedTimeSignature);
    expect(tempoSet).not.toHaveBeenCalled();
    expect(timeSignatureSet).not.toHaveBeenCalled();
    return transaction;
}

describe('prepareTimelineMapTimeOperation', () => {
    beforeEach(() => {
        setStoreStates(tempoState([]), timeSignatureState([]));
    });

    afterEach(() => {
        for (const unsubscribe of unsubscribers) {
            unsubscribe();
        }
        unsubscribers.length = 0;
        vi.restoreAllMocks();
    });

    it('prepares without effects and inserts time into both maps with exact boundary parity', () => {
        const tempoBefore = tempoChange('tempo-before', 3, 110);
        const tempoAt = tempoChange('tempo-at', 4, 120);
        const tempoAfter = tempoChange('tempo-after', 6, 130);
        const signatureBefore = timeSignatureChange('signature-before', 3, 3);
        const signatureAt = timeSignatureChange('signature-at', 4, 5);
        const signatureAfter = timeSignatureChange('signature-after', 6, 7);
        const capturedTempo = tempoState([tempoBefore, tempoAt, tempoAfter]);
        const capturedTimeSignature = timeSignatureState([signatureBefore, signatureAt, signatureAfter]);
        setStoreStates(capturedTempo, capturedTimeSignature);
        const tempoSet = vi.spyOn(tempoMapStore, 'set');
        const timeSignatureSet = vi.spyOn(timeSignatureMapStore, 'set');

        const transaction = prepareTimelineMapTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
        });

        expect(transaction.status).toBe('ready');
        expect(transaction.hasChanges).toBe(true);
        expect(tempoMapStore.value).toBe(capturedTempo);
        expect(timeSignatureMapStore.value).toBe(capturedTimeSignature);
        expect(tempoSet).not.toHaveBeenCalled();
        expect(timeSignatureSet).not.toHaveBeenCalled();

        expect(transaction.apply()).toBe(true);
        expect(tempoMapStore.value?.changes.map(({ id, beat }) => [id, beat])).toEqual([
            ['tempo-before', 3],
            ['tempo-at', 6],
            ['tempo-after', 8],
        ]);
        expect(timeSignatureMapStore.value?.changes.map(({ id, beat }) => [id, beat])).toEqual([
            ['signature-before', 3],
            ['signature-at', 6],
            ['signature-after', 8],
        ]);
        expect(tempoMapStore.value?.changes[0]).toBe(tempoBefore);
        expect(tempoMapStore.value?.changes[1]).not.toBe(tempoAt);
        expect(timeSignatureMapStore.value?.changes[0]).toBe(signatureBefore);
        expect(timeSignatureMapStore.value?.changes[1]).not.toBe(signatureAt);
        expect(tempoSet).toHaveBeenCalledOnce();
        expect(timeSignatureSet).toHaveBeenCalledOnce();
    });

    it('deletes the characterized half-open range from both maps while preserving order and identity', () => {
        const tempoBefore = tempoChange('tempo-before', 2, 110);
        const tempoEnd = tempoChange('tempo-end', 6, 130);
        const signatureBefore = timeSignatureChange('signature-before', 2, 3);
        const signatureEnd = timeSignatureChange('signature-end', 6, 6);
        setStoreStates(
            tempoState([
                tempoBefore,
                tempoChange('tempo-at', 3),
                tempoChange('tempo-inside', 4, 125),
                tempoEnd,
                tempoChange('tempo-after', 8, 140),
            ]),
            timeSignatureState([
                signatureBefore,
                timeSignatureChange('signature-at', 3),
                timeSignatureChange('signature-inside', 4, 5),
                signatureEnd,
                timeSignatureChange('signature-after', 8, 7),
            ])
        );

        const transaction = prepareTimelineMapTimeOperation({
            operation: { type: 'delete', startBeat: 3, endBeat: 6 },
        });

        expect(transaction.apply()).toBe(true);
        expect(tempoMapStore.value?.changes.map(({ id, beat }) => [id, beat])).toEqual([
            ['tempo-before', 2],
            ['tempo-end', 3],
            ['tempo-after', 5],
        ]);
        expect(timeSignatureMapStore.value?.changes.map(({ id, beat }) => [id, beat])).toEqual([
            ['signature-before', 2],
            ['signature-end', 3],
            ['signature-after', 5],
        ]);
        expect(tempoMapStore.value?.changes[0]).toBe(tempoBefore);
        expect(tempoMapStore.value?.changes[1]).not.toBe(tempoEnd);
        expect(timeSignatureMapStore.value?.changes[0]).toBe(signatureBefore);
        expect(timeSignatureMapStore.value?.changes[1]).not.toBe(signatureEnd);
    });

    describe('delete carries the tempo and meter in force at the span end forward to its start', () => {
        function deleteTime(startBeat: number, endBeat: number): void {
            const transaction = prepareTimelineMapTimeOperation({
                operation: { type: 'delete', startBeat, endBeat },
            });
            expect(transaction.status).toBe('ready');
            expect(transaction.apply()).toBe(true);
        }

        // The bar number differs after a cut that removes whole bars; the position inside the bar must not.
        function positionInBar(changes: TimeSignatureChange[], beat: number): { beat: number; tick: number } {
            const { beat: beatInBar, tick } = getBarBeatAtPosition(changes, beat, 4, 4);
            return { beat: beatInBar, tick };
        }

        function tempoEvents(): Array<[number, number]> {
            return (tempoMapStore.value?.changes ?? []).map(({ beat, tempo }) => [beat, tempo]);
        }

        function meterEvents(): Array<[number, number]> {
            return (timeSignatureMapStore.value?.changes ?? []).map(({ beat, numerator }) => [beat, numerator]);
        }

        it('inserts the tempo of a change inside the span at the span start, so later material keeps it', () => {
            setStoreStates(tempoState([tempoChange('a', 0, 120), tempoChange('b', 10, 60)]), timeSignatureState([]));

            deleteTime(9.5, 10.5);

            expect(tempoEvents()).toEqual([
                [0, 120],
                [9.5, 60],
            ]);
        });

        it('opens the carried meter where the first old downbeat lands, so material after the cut keeps its bars', () => {
            const capturedMeters = [timeSignatureChange('a', 0, 4), timeSignatureChange('b', 10, 3)];
            setStoreStates(tempoState([]), timeSignatureState(capturedMeters));

            deleteTime(9.5, 10.5);

            expect(meterEvents()).toEqual([
                [0, 4],
                [12, 3],
            ]);
            const after = timeSignatureMapStore.value?.changes ?? [];
            for (const [oldBeat, newBeat] of [
                [13, 12],
                [16, 15],
            ] as const) {
                const position = positionInBar(after, newBeat);
                expect(position).toEqual(positionInBar(capturedMeters, oldBeat));
                expect(position).toEqual({ beat: 1, tick: 0 });
            }
        });

        it('opens the carried meter on the span start when the span ends exactly on an old downbeat', () => {
            const capturedMeters = [timeSignatureChange('a', 0, 4), timeSignatureChange('b', 10, 3)];
            setStoreStates(tempoState([]), timeSignatureState(capturedMeters));

            deleteTime(8, 13);

            expect(meterEvents()).toEqual([
                [0, 4],
                [8, 3],
            ]);
            const after = timeSignatureMapStore.value?.changes ?? [];
            for (const [oldBeat, newBeat] of [
                [13, 8],
                [16, 11],
            ] as const) {
                expect(positionInBar(after, newBeat)).toEqual(positionInBar(capturedMeters, oldBeat));
            }
        });

        it('gives beat 0 the tempo in force at the span end when the span starts at 0', () => {
            setStoreStates(tempoState([tempoChange('a', 0, 120), tempoChange('b', 10, 60)]), timeSignatureState([]));

            deleteTime(0, 8);

            expect(tempoEvents()).toEqual([
                [0, 120],
                [2, 60],
            ]);
        });

        it('gives beat 0 the meter in force at the span end when the span starts at 0', () => {
            setStoreStates(
                tempoState([]),
                timeSignatureState([timeSignatureChange('a', 0, 4), timeSignatureChange('b', 10, 3)])
            );

            deleteTime(0, 8);

            expect(meterEvents()).toEqual([
                [0, 4],
                [2, 3],
            ]);
        });

        it('keeps the governing tempo when the only change lies inside a span that starts at 0', () => {
            setStoreStates(
                tempoState([tempoChange('a', 2, 100)]),
                timeSignatureState([timeSignatureChange('m', 2, 3)])
            );

            deleteTime(0, 8);

            expect(tempoEvents()).toEqual([[0, 100]]);
            expect(meterEvents()).toEqual([[0, 3]]);
        });

        it('keeps the first change governing the lead-in when the span removes it', () => {
            setStoreStates(tempoState([tempoChange('a', 5, 100), tempoChange('b', 10, 60)]), timeSignatureState([]));

            deleteTime(4, 8);

            expect(tempoEvents()).toEqual([
                [4, 100],
                [6, 60],
            ]);
        });

        it('carries the last of several changes inside the span', () => {
            setStoreStates(
                tempoState([
                    tempoChange('a', 0, 100),
                    tempoChange('b', 3, 110),
                    tempoChange('c', 4, 120),
                    tempoChange('d', 5, 130),
                    tempoChange('e', 12, 90),
                ]),
                timeSignatureState([
                    timeSignatureChange('m-a', 0, 4),
                    timeSignatureChange('m-b', 3, 5),
                    timeSignatureChange('m-c', 4, 6),
                    timeSignatureChange('m-d', 5, 7),
                    timeSignatureChange('m-e', 12, 3),
                ])
            );

            deleteTime(3.5, 6);

            expect(tempoEvents()).toEqual([
                [0, 100],
                [3, 110],
                [3.5, 130],
                [9.5, 90],
            ]);
            expect(meterEvents()).toEqual([
                [0, 4],
                [3, 5],
                [3.5, 7],
                [9.5, 3],
            ]);
        });

        it('adds no duplicate when the span ends exactly on a change', () => {
            setStoreStates(
                tempoState([tempoChange('a', 0, 120), tempoChange('b', 6, 90)]),
                timeSignatureState([timeSignatureChange('m-a', 0, 4), timeSignatureChange('m-b', 6, 3)])
            );

            deleteTime(4, 6);

            expect(tempoEvents()).toEqual([
                [0, 120],
                [4, 90],
            ]);
            expect(meterEvents()).toEqual([
                [0, 4],
                [4, 3],
            ]);
            expect(tempoMapStore.value?.changes[1]?.id).toBe('b');
            expect(timeSignatureMapStore.value?.changes[1]?.id).toBe('m-b');
        });

        it('adds nothing when the value in force at the span end already holds before its start', () => {
            setStoreStates(
                tempoState([tempoChange('a', 0, 120), tempoChange('b', 5, 90), tempoChange('c', 8, 120)]),
                timeSignatureState([
                    timeSignatureChange('m-a', 0, 4),
                    timeSignatureChange('m-b', 5, 3),
                    timeSignatureChange('m-c', 8, 4),
                ])
            );

            deleteTime(4, 12);

            expect(tempoEvents()).toEqual([[0, 120]]);
            expect(meterEvents()).toEqual([[0, 4]]);
        });

        it('re-opens the same meter where an old downbeat lands when the cut would shift the bar phase', () => {
            const capturedMeters = [
                timeSignatureChange('m-a', 0, 4),
                timeSignatureChange('m-b', 5, 3),
                timeSignatureChange('m-c', 7, 4),
            ];
            setStoreStates(tempoState([]), timeSignatureState(capturedMeters));

            deleteTime(4, 8);

            expect(meterEvents()).toEqual([
                [0, 4],
                [7, 4],
            ]);
            const after = timeSignatureMapStore.value?.changes ?? [];
            expect(positionInBar(after, 7)).toEqual(positionInBar(capturedMeters, 11));
        });

        it('keeps the tempo ramp in motion when the value at the span end matches the value before its start', () => {
            setStoreStates(
                tempoState([
                    tempoChange('a', 0, 120),
                    { id: 'b', beat: 5, tempo: 100, curve: 'linear' },
                    tempoChange('c', 10, 200),
                ]),
                timeSignatureState([])
            );

            deleteTime(4, 6);

            const after = tempoMapStore.value?.changes ?? [];
            expect(after.map(({ beat, tempo, curve }) => [beat, tempo, curve])).toEqual([
                [0, 120, 'instant'],
                [4, 120, 'linear'],
                [8, 200, 'instant'],
            ]);
            expect([4, 5, 6, 7].map((beat) => getTempoAtBeat(after, beat, 120))).toEqual([120, 140, 160, 180]);
        });

        it('keeps the slope before the cut and steps to the ramp value reached at the span end', () => {
            setStoreStates(
                tempoState([
                    { id: 'a', beat: 0, tempo: 100, curve: 'linear' },
                    { id: 'b', beat: 10, tempo: 200, curve: 'instant' },
                ]),
                timeSignatureState([])
            );

            deleteTime(4, 6);

            const after = tempoMapStore.value?.changes ?? [];
            expect(after.map(({ beat, tempo, curve }) => [beat, tempo, curve])).toEqual([
                [0, 100, 'linear'],
                [4, 140, 'instant'],
                [4, 160, 'linear'],
                [8, 200, 'instant'],
            ]);
            expect([2, 4, 6].map((beat) => getTempoAtBeat(after, beat, 120))).toEqual([120, 160, 180]);
        });

        it('lands the change that follows a non-dyadic cut exactly on the span start, after the ramp arrival', () => {
            setStoreStates(
                tempoState([
                    { id: 'a', beat: 0, tempo: 100, curve: 'linear' },
                    { id: 'b', beat: 2, tempo: 200, curve: 'instant' },
                ]),
                timeSignatureState([])
            );

            deleteTime(1 / 3, 2);

            const after = tempoMapStore.value?.changes ?? [];
            expect(after.map(({ id, beat }) => [id, beat])).toEqual([
                ['a', 0],
                [expect.any(String), 1 / 3],
                ['b', 1 / 3],
            ]);
            expect(after[1]?.tempo).toBeCloseTo(116.6667, 3);
            expect(getTempoAtBeat(after, 0.2, 120)).toBeCloseTo(110, 9);
            expect(getTempoAtBeat(after, 1, 120)).toBe(200);
        });

        it('lands a change three beats past a non-dyadic cut start exactly on the start', () => {
            setStoreStates(
                tempoState([
                    { id: 'a', beat: 0, tempo: 100, curve: 'linear' },
                    { id: 'b', beat: 3, tempo: 200, curve: 'instant' },
                ]),
                timeSignatureState([])
            );

            deleteTime(1 / 3, 3);

            const after = tempoMapStore.value?.changes ?? [];
            expect(after.map(({ id, beat }) => [id, beat])).toEqual([
                ['a', 0],
                [expect.any(String), 1 / 3],
                ['b', 1 / 3],
            ]);
        });

        it('keeps the slope before the cut and steps to the held tempo when a change inside the span follows the ramp', () => {
            setStoreStates(
                tempoState([
                    { id: 'a', beat: 0, tempo: 100, curve: 'linear' },
                    tempoChange('b', 5, 150),
                    tempoChange('c', 10, 200),
                ]),
                timeSignatureState([])
            );

            deleteTime(4, 6);

            const after = tempoMapStore.value?.changes ?? [];
            expect(after.map(({ beat, tempo, curve }) => [beat, tempo, curve])).toEqual([
                [0, 100, 'linear'],
                [4, 140, 'instant'],
                [4, 150, 'instant'],
                [8, 200, 'instant'],
            ]);
            expect(getTempoAtBeat(after, 2, 120)).toBe(120);
            expect([4, 5, 6, 7].map((beat) => getTempoAtBeat(after, beat, 120))).toEqual([150, 150, 150, 150]);
        });

        it('lands the arrival before the shifted change already on the span start', () => {
            setStoreStates(
                tempoState([
                    { id: 'a', beat: 0, tempo: 100, curve: 'linear' },
                    { id: 'b', beat: 6, tempo: 200, curve: 'instant' },
                ]),
                timeSignatureState([])
            );

            deleteTime(4, 6);

            const after = tempoMapStore.value?.changes ?? [];
            expect(after.map(({ id }) => id)).toEqual(['a', expect.stringMatching(/^tempo-/), 'b']);
            expect(after.map(({ beat, curve }) => [beat, curve])).toEqual([
                [0, 'linear'],
                [4, 'instant'],
                [4, 'instant'],
            ]);
            expect(after[1]?.tempo).toBeCloseTo(166.6667, 3);
            expect(after[2]?.tempo).toBe(200);
            expect(getTempoAtBeat(after, 2, 120)).toBeCloseTo(133.3333, 3);
            expect(getTempoAtBeat(after, 4, 120)).toBe(200);
        });

        it('adds no arrival when the ramp ends before the span', () => {
            setStoreStates(
                tempoState([
                    { id: 'a', beat: 0, tempo: 100, curve: 'linear' },
                    tempoChange('b', 2, 140),
                    tempoChange('c', 10, 200),
                ]),
                timeSignatureState([])
            );

            deleteTime(4, 6);

            expect(tempoEvents()).toEqual([
                [0, 100],
                [2, 140],
                [8, 200],
            ]);
        });

        it('adds no arrival when the first change on the span start already holds the value reached', () => {
            setStoreStates(
                tempoState([{ id: 'a', beat: 0, tempo: 100, curve: 'linear' }, tempoChange('b', 10, 100)]),
                timeSignatureState([])
            );

            deleteTime(4, 6);

            const after = tempoMapStore.value?.changes ?? [];
            expect(after.map(({ beat, tempo, curve }) => [beat, tempo, curve])).toEqual([
                [0, 100, 'linear'],
                [4, 100, 'linear'],
                [8, 100, 'instant'],
            ]);
        });

        it('adds no arrival after an instant change', () => {
            setStoreStates(tempoState([tempoChange('a', 0, 100), tempoChange('b', 10, 200)]), timeSignatureState([]));

            deleteTime(4, 12);

            expect(tempoEvents()).toEqual([
                [0, 100],
                [4, 200],
            ]);
        });

        it('chains a second cut across a ramp that already holds an arrival pair', () => {
            setStoreStates(
                tempoState([
                    { id: 'a', beat: 0, tempo: 100, curve: 'linear' },
                    { id: 'b', beat: 10, tempo: 200, curve: 'instant' },
                ]),
                timeSignatureState([])
            );
            deleteTime(4, 6);
            const first = tempoMapStore.value?.changes ?? [];

            deleteTime(2, 3);

            const after = tempoMapStore.value?.changes ?? [];
            // Beats before the second cut read as before; beats after it read as
            // the first map did one beat later.
            for (const beat of [0, 1, 1.9]) {
                expect(getTempoAtBeat(after, beat, 120)).toBeCloseTo(getTempoAtBeat(first, beat, 120), 9);
            }
            for (const beat of [2, 2.5, 3.5]) {
                expect(getTempoAtBeat(after, beat, 120)).toBeCloseTo(getTempoAtBeat(first, beat + 1, 120), 9);
            }
        });

        it('keeps the lead-in tempo when the span removes the first change', () => {
            setStoreStates(
                tempoState([tempoChange('a', 4, 100), tempoChange('b', 5, 80), tempoChange('c', 12, 140)]),
                timeSignatureState([])
            );

            deleteTime(2, 6);

            expect(tempoEvents()).toEqual([
                [0, 100],
                [2, 80],
                [8, 140],
            ]);
        });

        it('carries the span-end tempo past a kept lead-in that would otherwise read at the span start', () => {
            setStoreStates(
                tempoState([tempoChange('a', 4, 80), tempoChange('b', 6, 180), tempoChange('c', 10, 180)]),
                timeSignatureState([])
            );

            deleteTime(2, 8);

            const after = tempoMapStore.value?.changes ?? [];
            expect(after.map(({ beat, tempo }) => [beat, tempo])).toEqual([
                [0, 80],
                [2, 180],
                [4, 180],
            ]);
            expect([0, 1, 2, 3].map((beat) => getTempoAtBeat(after, beat, 120))).toEqual([80, 80, 180, 180]);
        });

        it('carries the span-end tempo past a kept lead-in when a ramp follows the cut', () => {
            setStoreStates(
                tempoState([
                    tempoChange('a', 4, 80),
                    tempoChange('b', 6, 180),
                    { id: 'c', beat: 10, tempo: 180, curve: 'linear' },
                    tempoChange('d', 14, 120),
                ]),
                timeSignatureState([])
            );

            deleteTime(2, 8);

            const after = tempoMapStore.value?.changes ?? [];
            expect(after.map(({ beat, tempo, curve }) => [beat, tempo, curve])).toEqual([
                [0, 80, 'instant'],
                [2, 180, 'instant'],
                [4, 180, 'linear'],
                [8, 120, 'instant'],
            ]);
            expect([2, 3].map((beat) => getTempoAtBeat(after, beat, 120))).toEqual([180, 180]);
        });

        it('keeps the lead-in tempo when the change at the span end becomes the first change', () => {
            setStoreStates(tempoState([tempoChange('a', 4, 100), tempoChange('b', 6, 80)]), timeSignatureState([]));

            deleteTime(2, 6);

            expect(tempoEvents()).toEqual([
                [0, 100],
                [2, 80],
            ]);
        });

        it('carries the implied meter of an empty map, so later bars keep their downbeats', () => {
            setStoreStates(tempoState([]), timeSignatureState([]));

            deleteTime(1, 2);

            expect(meterEvents()).toEqual([[3, 4]]);
            const after = timeSignatureMapStore.value?.changes ?? [];
            expect(positionInBar(after, 3)).toEqual(positionInBar([], 4));
            expect(positionInBar(after, 7)).toEqual(positionInBar([], 8));
        });

        it('carries the implied meter in force before the first explicit change', () => {
            const capturedMeters = [timeSignatureChange('a', 10, 3)];
            setStoreStates(tempoState([]), timeSignatureState(capturedMeters));

            deleteTime(1, 2);

            expect(meterEvents()).toEqual([
                [3, 4],
                [9, 3],
            ]);
            const after = timeSignatureMapStore.value?.changes ?? [];
            expect(positionInBar(after, 3)).toEqual(positionInBar(capturedMeters, 4));
        });

        it('carries no implied meter when the cut removes whole bars', () => {
            setStoreStates(tempoState([]), timeSignatureState([]));

            const transaction = expectClosedWithoutWrite({ type: 'delete', startBeat: 1, endBeat: 5 });

            expect(transaction.status).toBe('ready');
        });

        it('falls back to the span start when the first old downbeat lands on the next change', () => {
            setStoreStates(
                tempoState([]),
                timeSignatureState([timeSignatureChange('a', 0, 4), timeSignatureChange('b', 12, 3)])
            );

            deleteTime(9, 10);

            // A later downbeat of 4/4 would sit past the 3/4 change that already opens its own bar.
            expect(meterEvents()).toEqual([
                [0, 4],
                [11, 3],
            ]);
        });

        it('restores the exact previous maps on undo and re-creates the carried maps on redo', () => {
            const capturedTempo = tempoState([tempoChange('a', 0, 120), tempoChange('b', 10, 60)]);
            const capturedTimeSignature = timeSignatureState([
                timeSignatureChange('m-a', 0, 4),
                timeSignatureChange('m-b', 10, 3),
            ]);
            setStoreStates(capturedTempo, capturedTimeSignature);
            const transaction = prepareTimelineMapTimeOperation({
                operation: { type: 'delete', startBeat: 9.5, endBeat: 10.5 },
            });
            const plan = transaction.inversePlan;
            if (!plan) {
                throw new Error('Expected a changed delete to produce an inverse plan');
            }

            expect(transaction.apply()).toBe(true);
            const appliedTempo = tempoMapStore.value;
            const appliedTimeSignature = timeSignatureMapStore.value;
            expect(tempoEvents()).toEqual([
                [0, 120],
                [9.5, 60],
            ]);
            expect(meterEvents()).toEqual([
                [0, 4],
                [12, 3],
            ]);

            const undo = prepareTimelineMapStateRestore(plan);
            expect(undo.apply()).toBe(true);
            expect(tempoMapStore.value).toEqual(capturedTempo);
            expect(timeSignatureMapStore.value).toEqual(capturedTimeSignature);

            const redo = prepareTimelineMapStateRestore({
                version: 1,
                expected: plan.replacement,
                replacement: plan.expected,
            });
            expect(redo.apply()).toBe(true);
            expect(tempoMapStore.value).toEqual(appliedTempo);
            expect(timeSignatureMapStore.value).toEqual(appliedTimeSignature);
        });

        it('restores the exact maps on undo and redo of a cut that leaves two changes on one beat', () => {
            const capturedTempo = tempoState([
                { id: 'a', beat: 0, tempo: 100, curve: 'linear' },
                tempoChange('b', 10, 200),
            ]);
            setStoreStates(capturedTempo, timeSignatureState([]));
            const transaction = prepareTimelineMapTimeOperation({
                operation: { type: 'delete', startBeat: 4, endBeat: 6 },
            });
            const plan = transaction.inversePlan;
            if (!plan) {
                throw new Error('Expected a changed delete to produce an inverse plan');
            }

            expect(transaction.apply()).toBe(true);
            const appliedTempo = tempoMapStore.value;
            expect(appliedTempo?.changes.filter((change) => change.beat === 4)).toHaveLength(2);

            expect(prepareTimelineMapStateRestore(plan).apply()).toBe(true);
            expect(tempoMapStore.value).toEqual(capturedTempo);

            const redo = prepareTimelineMapStateRestore({
                version: 1,
                expected: plan.replacement,
                replacement: plan.expected,
            });
            expect(redo.apply()).toBe(true);
            expect(tempoMapStore.value).toEqual(appliedTempo);
        });

        it('reverts the transaction to the exact captured state identities', () => {
            const capturedTempo = tempoState([tempoChange('a', 0, 120), tempoChange('b', 10, 60)]);
            const capturedTimeSignature = timeSignatureState([
                timeSignatureChange('m-a', 0, 4),
                timeSignatureChange('m-b', 10, 3),
            ]);
            setStoreStates(capturedTempo, capturedTimeSignature);
            const transaction = prepareTimelineMapTimeOperation({
                operation: { type: 'delete', startBeat: 9.5, endBeat: 10.5 },
            });

            expect(transaction.apply()).toBe(true);
            expect(transaction.revert()).toBe(true);

            expect(tempoMapStore.value).toBe(capturedTempo);
            expect(timeSignatureMapStore.value).toBe(capturedTimeSignature);
        });
    });

    it.each([
        { type: 'insert' as const, atBeat: Number.NaN, durationBeats: 1 },
        { type: 'insert' as const, atBeat: -1, durationBeats: 1 },
        { type: 'insert' as const, atBeat: 0, durationBeats: 0 },
        { type: 'insert' as const, atBeat: 0, durationBeats: Number.POSITIVE_INFINITY },
        { type: 'delete' as const, startBeat: Number.NaN, endBeat: 4 },
        { type: 'delete' as const, startBeat: -1, endBeat: 4 },
        { type: 'delete' as const, startBeat: 4, endBeat: 4 },
        { type: 'delete' as const, startBeat: 5, endBeat: 4 },
        { type: 'delete' as const, startBeat: 0, endBeat: Number.POSITIVE_INFINITY },
    ])('rejects an invalid $type operation before either owner write', (operation) => {
        setStoreStates(
            tempoState([tempoChange('tempo', 4)]),
            timeSignatureState([timeSignatureChange('signature', 4)])
        );

        const transaction = expectClosedWithoutWrite(operation);
        expect(transaction.status).toBe('rejected');
    });

    it.each([
        {
            name: 'empty',
            tempo: tempoState([]),
            timeSignature: timeSignatureState([]),
        },
        {
            name: 'all-before-boundary',
            tempo: tempoState([tempoChange('tempo-before', 4)]),
            timeSignature: timeSignatureState([timeSignatureChange('signature-before', 4)]),
        },
    ])('rejects an overflowing insert endpoint with $name owner maps', ({ tempo, timeSignature }) => {
        setStoreStates(tempo, timeSignature);

        const transaction = expectClosedWithoutWrite({
            type: 'insert',
            atBeat: Number.MAX_VALUE,
            durationBeats: Number.MAX_VALUE,
        });

        expect(transaction.status).toBe('rejected');
    });

    it.each(['tempo', 'time-signature'] as const)(
        'rejects the whole operation when a computed beat overflows in the %s owner',
        (overflowOwner) => {
            const tempoBeat = overflowOwner === 'tempo' ? Number.MAX_VALUE : 4;
            const signatureBeat = overflowOwner === 'time-signature' ? Number.MAX_VALUE : 4;
            setStoreStates(
                tempoState([tempoChange('tempo', tempoBeat)]),
                timeSignatureState([timeSignatureChange('signature', signatureBeat)])
            );

            const transaction = expectClosedWithoutWrite({
                type: 'insert',
                atBeat: 0,
                durationBeats: Number.MAX_VALUE,
            });
            expect(transaction.status).toBe('rejected');
        }
    );

    it.each([
        {
            name: 'insert',
            operation: { type: 'insert' as const, atBeat: 0, durationBeats: 1 },
        },
        {
            name: 'delete',
            // Four beats is one bar of the implied 4/4, so the cut keeps every bar phase and carries no meter.
            operation: { type: 'delete' as const, startBeat: 0, endBeat: 4 },
        },
    ])('reports no change when finite $name arithmetic rounds to the original beats', ({ operation }) => {
        const tempo = tempoChange('tempo', Number.MAX_VALUE);
        const signature = timeSignatureChange('signature', Number.MAX_VALUE);
        const capturedTempo = tempoState([tempo]);
        const capturedTimeSignature = timeSignatureState([signature]);
        setStoreStates(capturedTempo, capturedTimeSignature);

        const transaction = expectClosedWithoutWrite(operation);
        expect(transaction.status).toBe('ready');
        expect(tempoMapStore.value?.changes[0]).toBe(tempo);
        expect(timeSignatureMapStore.value?.changes[0]).toBe(signature);
    });

    it('accepts empty owner maps and writes only a structurally changed owner', () => {
        setStoreStates(tempoState([]), timeSignatureState([]));
        const emptyTransaction = expectClosedWithoutWrite({ type: 'insert', atBeat: 4, durationBeats: 2 });
        expect(emptyTransaction.status).toBe('ready');
        vi.restoreAllMocks();

        const emptyTempo = tempoState([]);
        const capturedTimeSignature = timeSignatureState([timeSignatureChange('signature', 4)]);
        setStoreStates(emptyTempo, capturedTimeSignature);
        const tempoSet = vi.spyOn(tempoMapStore, 'set');
        const timeSignatureSet = vi.spyOn(timeSignatureMapStore, 'set');

        const transaction = prepareTimelineMapTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
        });

        expect(transaction.hasChanges).toBe(true);
        expect(transaction.apply()).toBe(true);
        expect(tempoMapStore.value).toBe(emptyTempo);
        expect(timeSignatureMapStore.value?.changes[0]?.beat).toBe(6);
        expect(tempoSet).not.toHaveBeenCalled();
        expect(timeSignatureSet).toHaveBeenCalledOnce();
    });

    it.each(['tempo', 'time-signature'] as const)('rejects when the %s owner store is missing', (missingOwner) => {
        const tempo = missingOwner === 'tempo' ? null : tempoState([tempoChange('tempo', 4)]);
        const timeSignature =
            missingOwner === 'time-signature' ? null : timeSignatureState([timeSignatureChange('signature', 4)]);
        setStoreStates(tempo, timeSignature);

        const transaction = expectClosedWithoutWrite({ type: 'insert', atBeat: 4, durationBeats: 2 });
        expect(transaction.status).toBe('rejected');
    });

    it.each(['tempo', 'time-signature'] as const)('stale-checks the %s owner before either apply write', (owner) => {
        const capturedTempo = tempoState([tempoChange('tempo', 4)]);
        const capturedTimeSignature = timeSignatureState([timeSignatureChange('signature', 4)]);
        setStoreStates(capturedTempo, capturedTimeSignature);
        const transaction = prepareTimelineMapTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
        });
        const interveningTempo = tempoState([...capturedTempo.changes]);
        const interveningTimeSignature = timeSignatureState([...capturedTimeSignature.changes]);
        if (owner === 'tempo') {
            tempoMapStore.set(interveningTempo);
        } else {
            timeSignatureMapStore.set(interveningTimeSignature);
        }
        const tempoSet = vi.spyOn(tempoMapStore, 'set');
        const timeSignatureSet = vi.spyOn(timeSignatureMapStore, 'set');

        expect(transaction.apply()).toBe(false);
        expect(tempoSet).not.toHaveBeenCalled();
        expect(timeSignatureSet).not.toHaveBeenCalled();

        setStoreStates(capturedTempo, capturedTimeSignature);
        tempoSet.mockClear();
        timeSignatureSet.mockClear();
        expect(transaction.apply()).toBe(false);
        expect(tempoSet).not.toHaveBeenCalled();
        expect(timeSignatureSet).not.toHaveBeenCalled();
    });

    it('enforces ordering and restores both exact captured state identities', () => {
        const capturedTempo = tempoState([tempoChange('tempo', 4)]);
        const capturedTimeSignature = timeSignatureState([timeSignatureChange('signature', 4)]);
        setStoreStates(capturedTempo, capturedTimeSignature);
        const transaction = prepareTimelineMapTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
        });

        expect(transaction.revert()).toBe(false);
        expect(transaction.apply()).toBe(true);
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(true);
        expect(tempoMapStore.value).toBe(capturedTempo);
        expect(timeSignatureMapStore.value).toBe(capturedTimeSignature);
        expect(transaction.revert()).toBe(false);
        expect(transaction.apply()).toBe(false);
    });

    it.each(['tempo', 'time-signature'] as const)('refuses stale revert across the %s owner and closes', (owner) => {
        const capturedTempo = tempoState([tempoChange('tempo', 4)]);
        const capturedTimeSignature = timeSignatureState([timeSignatureChange('signature', 4)]);
        setStoreStates(capturedTempo, capturedTimeSignature);
        const transaction = prepareTimelineMapTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
        });
        expect(transaction.apply()).toBe(true);
        const appliedTempo = tempoMapStore.value;
        const appliedTimeSignature = timeSignatureMapStore.value;
        const interveningTempo = tempoState([tempoChange('intervening-tempo', 12)]);
        const interveningTimeSignature = timeSignatureState([timeSignatureChange('intervening-signature', 12)]);
        if (owner === 'tempo') {
            tempoMapStore.set(interveningTempo);
        } else {
            timeSignatureMapStore.set(interveningTimeSignature);
        }
        const tempoSet = vi.spyOn(tempoMapStore, 'set');
        const timeSignatureSet = vi.spyOn(timeSignatureMapStore, 'set');

        expect(transaction.revert()).toBe(false);
        expect(tempoSet).not.toHaveBeenCalled();
        expect(timeSignatureSet).not.toHaveBeenCalled();

        setStoreStates(appliedTempo, appliedTimeSignature);
        tempoSet.mockClear();
        timeSignatureSet.mockClear();
        expect(transaction.revert()).toBe(false);
        expect(tempoSet).not.toHaveBeenCalled();
        expect(timeSignatureSet).not.toHaveBeenCalled();
    });

    it('batches apply and revert so both subscribers observe only complete states', () => {
        const capturedTempo = tempoState([tempoChange('tempo', 4)]);
        const capturedTimeSignature = timeSignatureState([timeSignatureChange('signature', 4)]);
        setStoreStates(capturedTempo, capturedTimeSignature);
        const observations = observeBothStores();
        const transaction = prepareTimelineMapTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
        });

        expect(observations).toEqual([]);
        expect(transaction.apply()).toBe(true);
        const appliedTempo = tempoMapStore.value;
        const appliedTimeSignature = timeSignatureMapStore.value;
        expect(observations).toHaveLength(2);
        for (const observation of observations) {
            expect(observation.tempo).toBe(appliedTempo);
            expect(observation.timeSignature).toBe(appliedTimeSignature);
        }

        observations.length = 0;
        expect(transaction.revert()).toBe(true);
        expect(observations).toHaveLength(2);
        for (const observation of observations) {
            expect(observation.tempo).toBe(capturedTempo);
            expect(observation.timeSignature).toBe(capturedTimeSignature);
        }
    });

    it('compensates an ordinary second-store apply failure inside the notification batch', () => {
        const capturedTempo = tempoState([tempoChange('tempo', 4)]);
        const capturedTimeSignature = timeSignatureState([timeSignatureChange('signature', 4)]);
        setStoreStates(capturedTempo, capturedTimeSignature);
        const observations = observeBothStores();
        const transaction = prepareTimelineMapTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
        });
        const publicationFailure = new Error('time-signature apply failed');
        const publishTimeSignature = timeSignatureMapStore.set.bind(timeSignatureMapStore);
        vi.spyOn(timeSignatureMapStore, 'set').mockImplementationOnce((nextState) => {
            publishTimeSignature(nextState);
            throw publicationFailure;
        });

        expect(() => transaction.apply()).toThrow(publicationFailure);
        expect(tempoMapStore.value).toBe(capturedTempo);
        expect(timeSignatureMapStore.value).toBe(capturedTimeSignature);
        expect(observations).toHaveLength(2);
        for (const observation of observations) {
            expect(observation.tempo).toBe(capturedTempo);
            expect(observation.timeSignature).toBe(capturedTimeSignature);
        }
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
    });

    it('compensates an ordinary second-store revert failure back to the complete applied state', () => {
        const capturedTempo = tempoState([tempoChange('tempo', 4)]);
        const capturedTimeSignature = timeSignatureState([timeSignatureChange('signature', 4)]);
        setStoreStates(capturedTempo, capturedTimeSignature);
        const transaction = prepareTimelineMapTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
        });
        expect(transaction.apply()).toBe(true);
        const appliedTempo = tempoMapStore.value;
        const appliedTimeSignature = timeSignatureMapStore.value;
        const observations = observeBothStores();
        const publicationFailure = new Error('time-signature revert failed');
        const publishTimeSignature = timeSignatureMapStore.set.bind(timeSignatureMapStore);
        vi.spyOn(timeSignatureMapStore, 'set').mockImplementationOnce((nextState) => {
            publishTimeSignature(nextState);
            throw publicationFailure;
        });

        expect(() => transaction.revert()).toThrow(publicationFailure);
        expect(tempoMapStore.value).toBe(appliedTempo);
        expect(timeSignatureMapStore.value).toBe(appliedTimeSignature);
        expect(observations).toHaveLength(2);
        for (const observation of observations) {
            expect(observation.tempo).toBe(appliedTempo);
            expect(observation.timeSignature).toBe(appliedTimeSignature);
        }
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
    });

    it('throws an explicit unrecovered-partial-state error carrying publication and compensation failures', () => {
        const capturedTempo = tempoState([tempoChange('tempo', 4)]);
        const capturedTimeSignature = timeSignatureState([timeSignatureChange('signature', 4)]);
        setStoreStates(capturedTempo, capturedTimeSignature);
        const transaction = prepareTimelineMapTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
        });
        const publicationFailure = new Error('time-signature publication failed');
        const compensationFailure = new Error('tempo compensation failed');
        const publishTempo = tempoMapStore.set.bind(tempoMapStore);
        const publishTimeSignature = timeSignatureMapStore.set.bind(timeSignatureMapStore);
        vi.spyOn(tempoMapStore, 'set')
            .mockImplementationOnce(publishTempo)
            .mockImplementationOnce(() => {
                throw compensationFailure;
            });
        vi.spyOn(timeSignatureMapStore, 'set').mockImplementationOnce((nextState) => {
            publishTimeSignature(nextState);
            throw publicationFailure;
        });

        let thrown: unknown;
        try {
            transaction.apply();
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(Error);
        if (!(thrown instanceof Error)) {
            throw new Error('Expected an Error instance');
        }
        expect(thrown).toMatchObject({
            name: 'UnrecoveredTimelineMapStateError',
            publicationFailure,
            compensationFailure,
        });
        expect(thrown.cause).toBeInstanceOf(AggregateError);
        if (!(thrown.cause instanceof AggregateError)) {
            throw new Error('Expected an AggregateError cause');
        }
        expect(thrown.cause.errors).toEqual([publicationFailure, compensationFailure]);
        expect(tempoMapStore.value).not.toBe(capturedTempo);
        expect(timeSignatureMapStore.value).toBe(capturedTimeSignature);
        expect(transaction.apply()).toBe(false);
        expect(transaction.revert()).toBe(false);
    });

    it.each([
        {
            name: 'sparse changes array',
            createTempoState: (): TempoMapStoreState => {
                const changes: TempoChange[] = [];
                changes.length = 1;
                return tempoState(changes);
            },
        },
        {
            name: 'class-instance state',
            createTempoState: (): TempoMapStoreState => {
                class TempoState implements TempoMapStoreState {
                    changes = [tempoChange('tempo', 4)];
                }
                return new TempoState();
            },
        },
        {
            name: 'accessor change',
            createTempoState: (): TempoMapStoreState => {
                const change = tempoChange('tempo', 4);
                Object.defineProperty(change, 'beat', {
                    enumerable: true,
                    get: () => 4,
                });
                return tempoState([change]);
            },
        },
    ])('rejects a non-encodable owner state with $name before writes', ({ createTempoState }) => {
        setStoreStates(createTempoState(), timeSignatureState([timeSignatureChange('signature', 4)]));

        const transaction = expectClosedWithoutWrite({ type: 'insert', atBeat: 4, durationBeats: 2 });

        expect(transaction.status).toBe('rejected');
    });

    it('returns an exact detached JSON-round-trippable inverse plan for a changed ready operation', () => {
        const capturedTempo = tempoState([tempoChange('tempo-zero', -0), tempoChange('tempo-shifted', 4)]);
        const capturedTimeSignature = timeSignatureState([
            timeSignatureChange('signature-zero', -0),
            timeSignatureChange('signature-shifted', 4),
        ]);
        setStoreStates(capturedTempo, capturedTimeSignature);

        const transaction = prepareTimelineMapTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
        });
        const plan = transaction.inversePlan;
        if (!plan) {
            throw new Error('Expected a changed operation to produce an inverse plan');
        }

        expect(transaction.status).toBe('ready');
        expect(transaction.hasChanges).toBe(true);
        expect(plan).toEqual({
            version: 1,
            expected: {
                tempo: {
                    changes: [
                        {
                            id: 'tempo-zero',
                            beat: { type: 'negative-zero' },
                            tempo: { type: 'number', value: 120 },
                            curve: 'instant',
                        },
                        {
                            id: 'tempo-shifted',
                            beat: { type: 'number', value: 6 },
                            tempo: { type: 'number', value: 120 },
                            curve: 'instant',
                        },
                    ],
                },
                timeSignature: {
                    changes: [
                        {
                            id: 'signature-zero',
                            beat: { type: 'negative-zero' },
                            numerator: { type: 'number', value: 4 },
                            denominator: { type: 'number', value: 4 },
                        },
                        {
                            id: 'signature-shifted',
                            beat: { type: 'number', value: 6 },
                            numerator: { type: 'number', value: 4 },
                            denominator: { type: 'number', value: 4 },
                        },
                    ],
                },
            },
            replacement: {
                tempo: {
                    changes: [
                        {
                            id: 'tempo-zero',
                            beat: { type: 'negative-zero' },
                            tempo: { type: 'number', value: 120 },
                            curve: 'instant',
                        },
                        {
                            id: 'tempo-shifted',
                            beat: { type: 'number', value: 4 },
                            tempo: { type: 'number', value: 120 },
                            curve: 'instant',
                        },
                    ],
                },
                timeSignature: {
                    changes: [
                        {
                            id: 'signature-zero',
                            beat: { type: 'negative-zero' },
                            numerator: { type: 'number', value: 4 },
                            denominator: { type: 'number', value: 4 },
                        },
                        {
                            id: 'signature-shifted',
                            beat: { type: 'number', value: 4 },
                            numerator: { type: 'number', value: 4 },
                            denominator: { type: 'number', value: 4 },
                        },
                    ],
                },
            },
        });
        expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
        expect(tempoMapStore.value).toBe(capturedTempo);
        expect(timeSignatureMapStore.value).toBe(capturedTimeSignature);

        plan.expected.tempo.changes[1]!.beat = { type: 'number', value: 12 };
        plan.replacement.timeSignature.changes[1]!.id = 'mutated-plan-id';
        expect(transaction.apply()).toBe(true);
        expect(tempoMapStore.value?.changes[1]?.beat).toBe(6);
        expect(transaction.revert()).toBe(true);
        expect(timeSignatureMapStore.value?.changes[1]?.id).toBe('signature-shifted');
    });

    it.each(['tempo', 'time-signature'] as const)(
        'detects in-place %s captured-state mutation before apply without writes',
        (owner) => {
            const capturedTempo = tempoState([tempoChange('tempo', 4)]);
            const capturedTimeSignature = timeSignatureState([timeSignatureChange('signature', 4)]);
            setStoreStates(capturedTempo, capturedTimeSignature);
            const transaction = prepareTimelineMapTimeOperation({
                operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
            });
            if (owner === 'tempo') {
                capturedTempo.changes[0]!.tempo = 121;
            } else {
                capturedTimeSignature.changes[0]!.numerator = 5;
            }
            const tempoSet = vi.spyOn(tempoMapStore, 'set');
            const timeSignatureSet = vi.spyOn(timeSignatureMapStore, 'set');

            expect(transaction.apply()).toBe(false);
            expect(tempoSet).not.toHaveBeenCalled();
            expect(timeSignatureSet).not.toHaveBeenCalled();
        }
    );

    it.each(['tempo', 'time-signature'] as const)(
        'detects in-place %s prepared-state mutation before revert without writes',
        (owner) => {
            setStoreStates(
                tempoState([tempoChange('tempo', 4)]),
                timeSignatureState([timeSignatureChange('signature', 4)])
            );
            const transaction = prepareTimelineMapTimeOperation({
                operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
            });
            expect(transaction.apply()).toBe(true);
            if (owner === 'tempo') {
                const appliedTempo = tempoMapStore.value;
                if (!appliedTempo) {
                    throw new Error('Expected applied tempo state');
                }
                appliedTempo.changes[0]!.tempo = 121;
            } else {
                const appliedTimeSignature = timeSignatureMapStore.value;
                if (!appliedTimeSignature) {
                    throw new Error('Expected applied time-signature state');
                }
                appliedTimeSignature.changes[0]!.numerator = 5;
            }
            const tempoSet = vi.spyOn(tempoMapStore, 'set');
            const timeSignatureSet = vi.spyOn(timeSignatureMapStore, 'set');

            expect(transaction.revert()).toBe(false);
            expect(tempoSet).not.toHaveBeenCalled();
            expect(timeSignatureSet).not.toHaveBeenCalled();
        }
    );

    it('rejects reentrant apply and revert while preserving the outer forward publication', () => {
        setStoreStates(
            tempoState([tempoChange('tempo', 4)]),
            timeSignatureState([timeSignatureChange('signature', 4)])
        );
        const transaction = prepareTimelineMapTimeOperation({
            operation: { type: 'insert', atBeat: 4, durationBeats: 2 },
        });
        const reentrantResults: boolean[] = [];
        unsubscribers.push(
            tempoMapStore.subscribe(() => {
                reentrantResults.push(transaction.apply());
                reentrantResults.push(transaction.revert());
            })
        );

        expect(transaction.apply()).toBe(true);
        expect(reentrantResults).toEqual([false, false]);
        expect(transaction.revert()).toBe(true);
        expect(reentrantResults).toEqual([false, false, false, false]);
    });
});
