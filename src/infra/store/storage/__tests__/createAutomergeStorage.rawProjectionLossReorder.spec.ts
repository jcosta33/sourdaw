import { describe, expect, it } from 'vitest';

import { createAutomergeStorage, findAutomergeStorageRawProjectionLosses } from '../createAutomergeStorage';

/**
 * Array containment in the raw projection-loss detector is order-insensitive.
 *
 * Inbound sanitizers legitimately normalize row order: the automation
 * sanitizer sorts each lane's points ascending by beat on entry, because
 * `AutomationPoint` carries no id and the CRDT reconciler whole-array-replaces
 * `points`, so a reconciled list can arrive unsorted. A sanitizer that only
 * reorders rows keeps every row's content, so it must not drive the project
 * into repair-required. A dropped row is still content loss and must still
 * report.
 */

type AutomationPoint = { beat: number; value: number };
type AutomationLane = { id: string; points: AutomationPoint[] };

function registerSanitizedSlot(slot: string, sanitize: (value: unknown) => unknown): void {
    createAutomergeStorage<unknown>('root', slot).registerInboundSanitizer?.(sanitize);
}

function findSlotLosses(slot: string, rawValue: unknown): string[] {
    return findAutomergeStorageRawProjectionLosses({ docId: 'root', document: { [slot]: rawValue } });
}

describe('createAutomergeStorage raw projection loss reordering', () => {
    it('reports no loss when the sanitizer returns identical rows in a different order', () => {
        registerSanitizedSlot('lanes', (value) => [...(value as AutomationLane[])].reverse());

        expect(
            findSlotLosses('lanes', [
                { id: 'lane-a', points: [] },
                { id: 'lane-b', points: [] },
            ])
        ).toEqual([]);
    });

    it('reports a loss when the sanitizer drops a row while reordering', () => {
        registerSanitizedSlot('lanes', (value) => [...(value as AutomationLane[])].reverse().slice(1));

        expect(
            findSlotLosses('lanes', [
                { id: 'lane-a', points: [] },
                { id: 'lane-b', points: [] },
                { id: 'lane-c', points: [] },
            ])
        ).toEqual(['lanes']);
    });

    it('reports no loss when a row object holds an inner points array the sanitizer reorders', () => {
        registerSanitizedSlot('automation', (value) => {
            const state = value as { lanes: AutomationLane[] };
            return {
                lanes: state.lanes.map((lane) => ({
                    ...lane,
                    points: [...lane.points].sort((left, right) => left.beat - right.beat),
                })),
            };
        });

        expect(
            findSlotLosses('automation', {
                lanes: [
                    {
                        id: 'lane-gain',
                        points: [
                            { beat: 176, value: 0.5 },
                            { beat: 148, value: 0.25 },
                            { beat: 32, value: 1 },
                        ],
                    },
                ],
            })
        ).toEqual([]);
    });

    it('reports no loss when reordered projected rows also gain extra keys', () => {
        registerSanitizedSlot('points', (value) =>
            (value as AutomationPoint[]).map((point) => ({ ...point, curve: 'linear' })).reverse()
        );

        expect(
            findSlotLosses('points', [
                { beat: 176, value: 0.5 },
                { beat: 148, value: 0.25 },
            ])
        ).toEqual([]);
    });

    it('reports a loss when duplicated raw rows project to a single row', () => {
        registerSanitizedSlot('points', (value) => {
            const seenBeats = new Set<number>();
            return (value as AutomationPoint[]).filter((point) => {
                if (seenBeats.has(point.beat)) {
                    return false;
                }
                seenBeats.add(point.beat);
                return true;
            });
        });

        expect(
            findSlotLosses('points', [
                { beat: 148, value: 0.25 },
                { beat: 176, value: 0.5 },
                { beat: 148, value: 0.25 },
            ])
        ).toEqual(['points']);
    });

    it('reports a loss when duplicated raw rows project to one row plus an unrelated row', () => {
        registerSanitizedSlot('points', (value) => {
            const seenBeats = new Set<number>();
            const deduped = (value as AutomationPoint[]).filter((point) => {
                if (seenBeats.has(point.beat)) {
                    return false;
                }
                seenBeats.add(point.beat);
                return true;
            });
            // The padding row keeps the length guard satisfied (2 >= 2), so
            // only distinct-item claiming can report the lost duplicate.
            return [...deduped, { beat: 999, value: 1 }];
        });

        expect(
            findSlotLosses('points', [
                { beat: 148, value: 0.25 },
                { beat: 148, value: 0.25 },
            ])
        ).toEqual(['points']);
    });

    it('reports no loss when the wide row containing a narrow one is emitted first', () => {
        registerSanitizedSlot('curves', (value) => {
            const rows = value as Array<{ beat: number; value: number; curve?: string }>;
            return [...rows.filter((row) => row.curve !== undefined), ...rows.filter((row) => row.curve === undefined)];
        });

        // First-fit claiming wastes the only row wide enough for the second
        // raw item on the first one, although swapping the assignment places
        // both rows, so no content was lost.
        expect(
            findSlotLosses('curves', [
                { beat: 148, value: 0.25 },
                { beat: 148, value: 0.25, curve: 'linear' },
            ])
        ).toEqual([]);
    });

    it('reports no loss when undefined rows survive sanitization verbatim', () => {
        registerSanitizedSlot('points', (value) => [...(value as unknown[])]);

        // `undefined` is a representable value in an `unknown[]` slot; it must
        // claim its projected twin like any other row, not read as "no row".
        expect(findSlotLosses('points', [undefined, undefined])).toEqual([]);
    });

    it('reports a loss when duplicated undefined rows project to one row plus an unrelated row', () => {
        registerSanitizedSlot('points', (value) => [(value as unknown[])[0], { beat: 999, value: 1 }]);

        // The padding row keeps the length guard satisfied (2 >= 2); only one
        // projected row can contain an undefined raw row, so the duplicate is
        // a loss.
        expect(findSlotLosses('points', [undefined, undefined])).toEqual(['points']);
    });
});
