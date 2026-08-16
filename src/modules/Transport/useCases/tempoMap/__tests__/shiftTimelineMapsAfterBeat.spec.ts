import { describe, it, expect, vi, beforeEach } from 'vitest';

type TempoState = { changes: { id: string; beat: number; tempo: number; curve: string }[] };
type TimeSigState = { changes: { id: string; beat: number; numerator: number; denominator: number }[] };

const { tempoMapStoreValue, timeSignatureMapStoreValue, tempoMapStoreSet, timeSignatureMapStoreSet } = vi.hoisted(
    (): {
        tempoMapStoreValue: { value: TempoState | null };
        timeSignatureMapStoreValue: { value: TimeSigState | null };
        tempoMapStoreSet: ReturnType<typeof vi.fn>;
        timeSignatureMapStoreSet: ReturnType<typeof vi.fn>;
    } => ({
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

    it('clamps a shift that would land below beat 0 to beat 0 instead of leaving it negative', () => {
        // A large negative deltaBeats (e.g. deleting more than exists before the
        // shift point) must not leave a permanently active negative-beat change.
        tempoMapStoreValue.value = {
            changes: [{ id: 'tempo-at', beat: 4, tempo: 120, curve: 'instant' }],
        };
        timeSignatureMapStoreValue.value = {
            changes: [{ id: 'sig-at', beat: 4, numerator: 5, denominator: 4 }],
        };

        shiftTimelineMapsAfterBeat({ atBeat: 4, deltaBeats: -10 });

        expect(tempoMapStoreSet).toHaveBeenCalledWith({
            changes: [{ id: 'tempo-at', beat: 0, tempo: 120, curve: 'instant' }],
        });
        expect(timeSignatureMapStoreSet).toHaveBeenCalledWith({
            changes: [{ id: 'sig-at', beat: 0, numerator: 5, denominator: 4 }],
        });
    });
});
