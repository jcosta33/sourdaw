import { describe, expect, it } from 'vitest';

import { isExactClipAutomationMoveSnapshots } from '../isExactClipAutomationMoveSnapshots';

function validSnapshot() {
    return [
        {
            id: 'lane-a',
            trackId: 'track-a',
            points: [
                {
                    id: 'point-a',
                    beat: 1,
                    value: 0.5,
                    curve: 'bezier',
                    tension: 0.2,
                    cp1: { x: 0.2, y: 0.4 },
                    cp2: { x: 0.8, y: 0.6 },
                },
            ],
        },
    ];
}

describe('exact clip automation move snapshots', () => {
    it('admits the producer partial snapshot and an empty capture', () => {
        expect(isExactClipAutomationMoveSnapshots(validSnapshot())).toBe(true);
        expect(isExactClipAutomationMoveSnapshots([])).toBe(true);
    });

    it('rejects duplicate, sparse, extra-field, and invalid-point captures', () => {
        const duplicate = [...validSnapshot(), ...validSnapshot()];
        const sparse: unknown[] = [];
        sparse.length = 1;
        expect(isExactClipAutomationMoveSnapshots(duplicate)).toBe(false);
        expect(isExactClipAutomationMoveSnapshots(sparse)).toBe(false);
        expect(isExactClipAutomationMoveSnapshots([{ ...validSnapshot()[0], parameterId: 'gain' }])).toBe(false);
        expect(isExactClipAutomationMoveSnapshots([{ ...validSnapshot()[0], trackId: '' }])).toBe(false);
        expect(
            isExactClipAutomationMoveSnapshots([
                { ...validSnapshot()[0], points: [{ ...validSnapshot()[0]!.points[0], curve: 'other' }] },
            ])
        ).toBe(false);
    });
});
