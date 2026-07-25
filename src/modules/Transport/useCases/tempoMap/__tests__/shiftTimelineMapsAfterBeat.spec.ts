import { describe, it, expect, vi, beforeEach } from 'vitest';

const { tempoMapStoreValue, timeSignatureMapStoreValue, tempoMapStoreSet, timeSignatureMapStoreSet } = vi.hoisted(
    () => ({
        tempoMapStoreValue: {
            value: {
                changes: [
                    { id: 'tempo-before', beat: 3, tempo: 110, curve: 'instant' },
                    { id: 'tempo-at', beat: 4, tempo: 120, curve: 'linear' },
                    { id: 'tempo-after', beat: 6, tempo: 130, curve: 'instant' },
                ],
            },
        },
        timeSignatureMapStoreValue: {
            value: {
                changes: [
                    { id: 'sig-before', beat: 3, numerator: 3, denominator: 4 },
                    { id: 'sig-at', beat: 4, numerator: 5, denominator: 4 },
                    { id: 'sig-after', beat: 6, numerator: 7, denominator: 8 },
                ],
            },
        },
        tempoMapStoreSet: vi.fn(),
        timeSignatureMapStoreSet: vi.fn(),
    })
);

vi.mock('../../../stores/tempoMapStore', () => ({
    tempoMapStore: {
        get value() {
            return tempoMapStoreValue.value;
        },
        set: tempoMapStoreSet,
    },
}));

vi.mock('../../../stores/timeSignatureMapStore', () => ({
    timeSignatureMapStore: {
        get value() {
            return timeSignatureMapStoreValue.value;
        },
        set: timeSignatureMapStoreSet,
    },
}));

import { shiftTimelineMapsAfterBeat } from '../shiftTimelineMapsAfterBeat';

describe('shiftTimelineMapsAfterBeat', () => {
    beforeEach(() => {
        tempoMapStoreValue.value = {
            changes: [
                { id: 'tempo-before', beat: 3, tempo: 110, curve: 'instant' },
                { id: 'tempo-at', beat: 4, tempo: 120, curve: 'linear' },
                { id: 'tempo-after', beat: 6, tempo: 130, curve: 'instant' },
            ],
        };
        timeSignatureMapStoreValue.value = {
            changes: [
                { id: 'sig-before', beat: 3, numerator: 3, denominator: 4 },
                { id: 'sig-at', beat: 4, numerator: 5, denominator: 4 },
                { id: 'sig-after', beat: 6, numerator: 7, denominator: 8 },
            ],
        };
        tempoMapStoreSet.mockClear();
        timeSignatureMapStoreSet.mockClear();
    });

    it('should shift tempo and time-signature changes at or after the insertion beat', () => {
        shiftTimelineMapsAfterBeat({ atBeat: 4, deltaBeats: 2 });

        expect(tempoMapStoreSet).toHaveBeenCalledWith({
            changes: [
                { id: 'tempo-before', beat: 3, tempo: 110, curve: 'instant' },
                { id: 'tempo-at', beat: 6, tempo: 120, curve: 'linear' },
                { id: 'tempo-after', beat: 8, tempo: 130, curve: 'instant' },
            ],
        });
        expect(timeSignatureMapStoreSet).toHaveBeenCalledWith({
            changes: [
                { id: 'sig-before', beat: 3, numerator: 3, denominator: 4 },
                { id: 'sig-at', beat: 6, numerator: 5, denominator: 4 },
                { id: 'sig-after', beat: 8, numerator: 7, denominator: 8 },
            ],
        });
    });

    it('is a no-op for each store that has no state (defensive null guard)', () => {
        // Both stores can be null before initial load; each `if (state)` guard
        // must skip that store without calling set, while the other still shifts.
        tempoMapStoreValue.value = null;
        timeSignatureMapStoreValue.value = {
            changes: [{ id: 'sig-at', beat: 4, numerator: 5, denominator: 4 }],
        };

        shiftTimelineMapsAfterBeat({ atBeat: 4, deltaBeats: 2 });

        expect(tempoMapStoreSet).not.toHaveBeenCalled();
        expect(timeSignatureMapStoreSet).toHaveBeenCalledWith({
            changes: [{ id: 'sig-at', beat: 6, numerator: 5, denominator: 4 }],
        });
    });

    it('skips the time-sig store when it has no state', () => {
        // Mirror of the tempo-store case: time-sig null must skip its set while
        // the tempo store still shifts.
        tempoMapStoreValue.value = {
            changes: [{ id: 'tempo-at', beat: 4, tempo: 120, curve: 'instant' }],
        };
        timeSignatureMapStoreValue.value = null;

        shiftTimelineMapsAfterBeat({ atBeat: 4, deltaBeats: 2 });

        expect(timeSignatureMapStoreSet).not.toHaveBeenCalled();
        expect(tempoMapStoreSet).toHaveBeenCalledWith({
            changes: [{ id: 'tempo-at', beat: 6, tempo: 120, curve: 'instant' }],
        });
    });
});
