import { describe, it, expect, vi, beforeEach } from 'vitest';

const { setMock, mockStore } = vi.hoisted(() => {
    const ref = {
        value: { changes: [] as { id: string; beat: number; numerator: number; denominator: number }[] } as {
            changes: { id: string; beat: number; numerator: number; denominator: number }[];
        } | null,
    };
    const setMock = vi.fn((next: typeof ref.value) => {
        ref.value = next;
    });
    return { setMock, mockStore: ref };
});

vi.mock('../../../stores/timeSignatureMapStore', () => ({
    timeSignatureMapStore: {
        get value() {
            return mockStore.value;
        },
        set: setMock,
    },
}));

import * as subject from '../removeTimeSignatureChange';

describe('removeTimeSignatureChange', () => {
    beforeEach(() => {
        mockStore.value = { changes: [] };
        setMock.mockClear();
    });

    it('should export removeTimeSignatureChange', () => {
        expect(subject.removeTimeSignatureChange).toBeDefined();
        const time = typeof subject.removeTimeSignatureChange;
        expect(time === 'function' || time === 'object').toBe(true);
    });

    it('removes the change at the requested beat', () => {
        mockStore.value = {
            changes: [
                { id: 'a', beat: 0, numerator: 4, denominator: 4 },
                { id: 'b', beat: 8, numerator: 3, denominator: 4 },
            ],
        };
        subject.removeTimeSignatureChange(0);
        expect(setMock.mock.calls[0]![0]!.changes.map((context) => context.beat)).toEqual([8]);
    });

    it('still removes a change whose stored beat drifted by a sub-tick amount', () => {
        // A save/load round-trip can perturb the stored beat below one tick.
        // Strict `!==` would never match and silently keep the change; the epsilon
        // tolerance must still remove it when asked to drop beat 8.
        mockStore.value = {
            changes: [
                { id: 'a', beat: 0, numerator: 4, denominator: 4 },
                { id: 'b', beat: 8 + 1e-9, numerator: 3, denominator: 4 },
            ],
        };
        subject.removeTimeSignatureChange(8);
        expect(setMock.mock.calls[0]![0]!.changes.map((context) => context.id)).toEqual(['a']);
    });

    it('is a no-op when the time-sig store has no state', () => {
        // Defensive guard against a null store snapshot: must not throw, must
        // not call set.
        mockStore.value = null;
        subject.removeTimeSignatureChange(0);
        expect(setMock).not.toHaveBeenCalled();
    });
});
