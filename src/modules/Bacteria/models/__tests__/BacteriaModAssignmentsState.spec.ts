import { describe, expect, it } from 'vitest';

import {
    BACTERIA_MOD_ASSIGNMENTS_STATE_VERSION,
    fromBacteriaModAssignmentsState,
    toBacteriaModAssignmentsState,
} from '../BacteriaModAssignmentsState';
import { type BacteriaModAssignment } from '../BacteriaPatch';

function row(overrides: Partial<BacteriaModAssignment> = {}): BacteriaModAssignment {
    return { sourceId: 'lfo1', targetParam: 'band0_drive', amount: 0.5, bipolar: true, ...overrides };
}

describe('BacteriaModAssignmentsState codec', () => {
    it('round-trips two valid rows unchanged', () => {
        const rows = [
            row(),
            row({ sourceId: 'macro1', targetParam: 'band1_filterCutoff', amount: -0.25, bipolar: false }),
        ];

        const restored = fromBacteriaModAssignmentsState(toBacteriaModAssignmentsState(rows));

        expect(restored).toEqual(rows);
    });

    it('stamps the envelope version so a later reader can identify the payload', () => {
        expect(toBacteriaModAssignmentsState([]).version).toBe(BACTERIA_MOD_ASSIGNMENTS_STATE_VERSION);
    });

    it.each([
        [
            'a version this build does not know',
            { version: BACTERIA_MOD_ASSIGNMENTS_STATE_VERSION + 1, data: { modAssignments: [row()] } },
        ],
        [
            'a modAssignments field that is not an array',
            { version: BACTERIA_MOD_ASSIGNMENTS_STATE_VERSION, data: { modAssignments: {} } },
        ],
        ['undefined', undefined],
    ])('returns null for %s', (_label, chunk) => {
        expect(fromBacteriaModAssignmentsState(chunk)).toBeNull();
    });

    it('drops a row with a non-finite amount or a numeric sourceId, keeping the valid one', () => {
        const chunk = {
            version: BACTERIA_MOD_ASSIGNMENTS_STATE_VERSION,
            data: {
                modAssignments: [
                    row(),
                    { sourceId: 'lfo2', targetParam: 'mix', amount: Number.NaN, bipolar: false },
                    { sourceId: 0, targetParam: 'mix', amount: 0.4, bipolar: false },
                ],
            },
        };

        expect(fromBacteriaModAssignmentsState(chunk)).toEqual([row()]);
    });
});
