import { beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';

import { type TransportState, defaultTransportState } from '../../../models/TransportState';
import { transportStore } from '../../../stores/transportStore';
import { restorePunchRegion } from '../restorePunchRegion';
import { setPunchIn } from '../setPunchIn';
import { setPunchOut } from '../setPunchOut';

type PunchRegion = Pick<TransportState, 'punchInBeat' | 'punchOutBeat'>;

type PunchEdit = {
    edge: 'in' | 'out';
    beat: number;
    expected: PunchRegion;
};

const FIRST_UNSAFE_INTEGER = Number.MAX_SAFE_INTEGER + 1;
const NEXT_REPRESENTABLE_LARGE_INTEGER = FIRST_UNSAFE_INTEGER + 2;

function get_punch_region(): PunchRegion {
    const state = transportStore.value;
    if (!state) {
        throw new Error('Expected Transport state');
    }

    return {
        punchInBeat: state.punchInBeat,
        punchOutBeat: state.punchOutBeat,
    };
}

function expect_valid_punch_region(region: PunchRegion): void {
    expect(Number.isFinite(region.punchInBeat)).toBe(true);
    expect(Number.isFinite(region.punchOutBeat)).toBe(true);
    expect(region.punchInBeat).toBeGreaterThanOrEqual(0);
    expect(region.punchOutBeat).toBeGreaterThan(region.punchInBeat);
}

function apply_punch_edit(edit: PunchEdit): void {
    if (edit.edge === 'in') {
        setPunchIn(edit.beat);
    } else {
        setPunchOut(edit.beat);
    }

    const next = get_punch_region();
    expect(next).toEqual(edit.expected);
    expect_valid_punch_region(next);
}

describe('punch region numerical state machine', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        transportStore.set({ ...defaultTransportState });
    });

    it('applies boundary edits to evolving Transport state without losing strict order', () => {
        expect(FIRST_UNSAFE_INTEGER + 1).toBe(FIRST_UNSAFE_INTEGER);

        const edits = [
            { edge: 'in', beat: -0, expected: { punchInBeat: 0, punchOutBeat: 16 } },
            {
                edge: 'out',
                beat: Number.MIN_VALUE,
                expected: { punchInBeat: 0, punchOutBeat: Number.MIN_VALUE },
            },
            {
                edge: 'in',
                beat: Number.MIN_VALUE,
                expected: { punchInBeat: Number.MIN_VALUE, punchOutBeat: 1 },
            },
            { edge: 'out', beat: 0.5, expected: { punchInBeat: Number.MIN_VALUE, punchOutBeat: 0.5 } },
            { edge: 'in', beat: 0.25, expected: { punchInBeat: 0.25, punchOutBeat: 0.5 } },
            { edge: 'out', beat: 0.75, expected: { punchInBeat: 0.25, punchOutBeat: 0.75 } },
            { edge: 'out', beat: 0.75, expected: { punchInBeat: 0.25, punchOutBeat: 0.75 } },
            { edge: 'in', beat: 1.25, expected: { punchInBeat: 1.25, punchOutBeat: 2.25 } },
            { edge: 'out', beat: 0.5, expected: { punchInBeat: 0, punchOutBeat: 0.5 } },
            {
                edge: 'in',
                beat: Number.MAX_SAFE_INTEGER,
                expected: { punchInBeat: Number.MAX_SAFE_INTEGER, punchOutBeat: FIRST_UNSAFE_INTEGER },
            },
            {
                edge: 'in',
                beat: FIRST_UNSAFE_INTEGER,
                expected: {
                    punchInBeat: FIRST_UNSAFE_INTEGER,
                    punchOutBeat: NEXT_REPRESENTABLE_LARGE_INTEGER,
                },
            },
            {
                edge: 'in',
                beat: FIRST_UNSAFE_INTEGER,
                expected: {
                    punchInBeat: FIRST_UNSAFE_INTEGER,
                    punchOutBeat: NEXT_REPRESENTABLE_LARGE_INTEGER,
                },
            },
            {
                edge: 'out',
                beat: FIRST_UNSAFE_INTEGER,
                expected: { punchInBeat: Number.MAX_SAFE_INTEGER, punchOutBeat: FIRST_UNSAFE_INTEGER },
            },
        ] satisfies PunchEdit[];

        for (const edit of edits) {
            apply_punch_edit(edit);
        }

        setPunchIn(Number.MAX_VALUE);
        const maximum_region = get_punch_region();
        expect(maximum_region.punchOutBeat).toBe(Number.MAX_VALUE);
        expect(maximum_region.punchInBeat).toBeLessThan(Number.MAX_VALUE);
        expect_valid_punch_region(maximum_region);

        setPunchOut(Number.MAX_VALUE);
        expect(get_punch_region()).toEqual(maximum_region);
        expect_valid_punch_region(get_punch_region());
    });

    it('preserves exact pairs through alternating crossings in both directions', () => {
        const edits = [
            { edge: 'in', beat: 20, expected: { punchInBeat: 20, punchOutBeat: 21 } },
            { edge: 'out', beat: 4, expected: { punchInBeat: 3, punchOutBeat: 4 } },
            { edge: 'in', beat: 30, expected: { punchInBeat: 30, punchOutBeat: 31 } },
            { edge: 'out', beat: 2, expected: { punchInBeat: 1, punchOutBeat: 2 } },
        ] satisfies PunchEdit[];

        for (const edit of edits) {
            apply_punch_edit(edit);
        }
    });

    it('rejects non-finite edits in both directions without changing evolving Transport state', () => {
        const edits = [
            { edge: 'in', rejectedBeat: Number.NaN, nextFiniteBeat: 4 },
            { edge: 'out', rejectedBeat: Number.NaN, nextFiniteBeat: 12 },
            { edge: 'in', rejectedBeat: Number.POSITIVE_INFINITY, nextFiniteBeat: 6 },
            { edge: 'out', rejectedBeat: Number.POSITIVE_INFINITY, nextFiniteBeat: 10 },
            { edge: 'in', rejectedBeat: Number.NEGATIVE_INFINITY, nextFiniteBeat: 8 },
            { edge: 'out', rejectedBeat: Number.NEGATIVE_INFINITY, nextFiniteBeat: 9 },
        ] as const;

        for (const edit of edits) {
            const before_rejected_edit = get_punch_region();

            if (edit.edge === 'in') {
                setPunchIn(edit.rejectedBeat);
            } else {
                setPunchOut(edit.rejectedBeat);
            }

            expect(get_punch_region()).toEqual(before_rejected_edit);

            if (edit.edge === 'in') {
                setPunchIn(edit.nextFiniteBeat);
            } else {
                setPunchOut(edit.nextFiniteBeat);
            }

            const after_finite_edit = get_punch_region();
            expect(after_finite_edit).not.toEqual(before_rejected_edit);
            expect_valid_punch_region(after_finite_edit);
        }
    });

    it('shares the same invariant with atomic punch-region restoration', () => {
        const valid_regions = [
            { punchInBeat: -0, punchOutBeat: Number.MIN_VALUE },
            { punchInBeat: 0.25, punchOutBeat: 0.5 },
            { punchInBeat: Number.MAX_SAFE_INTEGER, punchOutBeat: FIRST_UNSAFE_INTEGER },
            { punchInBeat: FIRST_UNSAFE_INTEGER, punchOutBeat: NEXT_REPRESENTABLE_LARGE_INTEGER },
        ];

        for (const region of valid_regions) {
            restorePunchRegion({ expected: get_punch_region(), replacement: region });
            expect(get_punch_region()).toEqual(region);
            expect_valid_punch_region(get_punch_region());
        }

        const before_invalid_restores = get_punch_region();
        for (const invalid_region of [
            { punchInBeat: Number.NaN, punchOutBeat: 4 },
            { punchInBeat: 0, punchOutBeat: Number.POSITIVE_INFINITY },
            { punchInBeat: -1, punchOutBeat: 4 },
            { punchInBeat: 4, punchOutBeat: 4 },
            { punchInBeat: 8, punchOutBeat: 4 },
        ]) {
            restorePunchRegion({ expected: before_invalid_restores, replacement: invalid_region });
            expect(get_punch_region()).toEqual(before_invalid_restores);
            expect_valid_punch_region(get_punch_region());
        }
    });
});
