import { describe, expect, it, vi } from 'vitest';

import { decodeTempoMapRowPlan, type TempoMapRowPlan } from '../tempoMapRowPlan';

const row = { id: 'new', beat: 4, tempo: 120, curve: 'instant' as const };
const plan: TempoMapRowPlan = {
    operation: 'add',
    before: [],
    after: [row],
    order: [{ beat: 4, before: [], after: ['new'] }],
    collision: { beat: 4, targetId: null },
};

describe('tempo-map row plan structural codec', () => {
    it('round-trips a JSON plan without aliasing caller-owned rows or order arrays', () => {
        const value = JSON.parse(JSON.stringify(plan));
        const decoded = decodeTempoMapRowPlan(value);
        expect(decoded).toEqual(plan);
        value.after[0].tempo = 90;
        value.order[0].after.push('foreign');
        expect(decoded).toEqual(plan);
    });

    it.each([
        { ...plan, foreign: true },
        { ...plan, after: [{ ...row, foreign: true }] },
        { ...plan, after: [{ ...row, curve: 'exponential' }] },
        { ...plan, after: [{ ...row, tempo: Number.NaN }] },
        { ...plan, after: [{ ...row, beat: -1 }] },
        { ...plan, after: [{ ...row, id: '' }] },
        { ...plan, order: [] },
        { ...plan, order: [{ beat: 4, before: [], after: ['wrong'] }] },
        { ...plan, order: [{ beat: 4, before: [], after: ['new', 'new'] }] },
        { ...plan, order: [{ beat: 4, before: [], after: ['new'], foreign: true }] },
        { ...plan, collision: { beat: 4, targetId: null, foreign: true } },
        { ...plan, collision: undefined },
        { ...plan, operation: 'remove' },
        { operation: 'update', before: [row], after: [row], order: [] },
    ])('rejects malformed or incoherent paired data %j', (value) => {
        expect(decodeTempoMapRowPlan(value)).toBeNull();
    });

    it('rejects duplicate owned IDs, sparse arrays and accessor data without reading getters', () => {
        expect(decodeTempoMapRowPlan({ ...plan, after: [row, row] })).toBeNull();
        const sparse: unknown[] = [];
        sparse.length = 1;
        expect(decodeTempoMapRowPlan({ ...plan, after: sparse })).toBeNull();
        const getter = vi.fn(() => 'add');
        const accessor = { ...plan };
        Object.defineProperty(accessor, 'operation', { enumerable: true, get: getter });
        expect(decodeTempoMapRowPlan(accessor)).toBeNull();
        expect(getter).not.toHaveBeenCalled();
    });

    it('rejects a forged retained ID moved to another beat or changed curve by update', () => {
        const update = { operation: 'update', before: [row], after: [{ ...row, tempo: 140 }], order: [] };
        expect(decodeTempoMapRowPlan(update)).toEqual(update);
        expect(decodeTempoMapRowPlan({ ...update, after: [{ ...row, beat: 8 }] })).toBeNull();
        expect(decodeTempoMapRowPlan({ ...update, after: [{ ...row, curve: 'linear' }] })).toBeNull();
    });

    it('keeps semantic tempo bounds with Transport rather than duplicating them in the neutral codec', () => {
        expect(decodeTempoMapRowPlan({ ...plan, after: [{ ...row, tempo: 1000 }] })).not.toBeNull();
    });
});
