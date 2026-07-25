import { describe, it, expect, vi, beforeEach } from 'vitest';

type TempoChange = {
    id: string;
    beat: number;
    tempo: number;
    curve: 'instant' | 'linear';
};

type TempoMapStoreState = {
    changes: TempoChange[];
};

const { setMock, mockStore } = vi.hoisted(() => {
    const ref = {
        value: { changes: [] as TempoChange[] } as TempoMapStoreState | null,
    };
    const setMock = vi.fn((next: typeof ref.value) => {
        ref.value = next;
    });
    return { setMock, mockStore: ref };
});

vi.mock('../../../stores/tempoMapStore', () => ({
    tempoMapStore: {
        get value() {
            return mockStore.value;
        },
        set: setMock,
    },
}));

import * as subject from '../updateTempoChange';

describe('updateTempoChange', () => {
    beforeEach(() => {
        mockStore.value = { changes: [] };
        setMock.mockClear();
    });

    it('should export updateTempoChange', () => {
        expect(subject.updateTempoChange).toBeDefined();
        const kind = typeof subject.updateTempoChange;
        expect(kind === 'function' || kind === 'object').toBe(true);
    });

    it('clamps the new tempo into the [20, 999] range when updating', () => {
        // Tempo is constrained to the valid DAW range; an out-of-range input is
        // clamped, never stored raw.
        mockStore.value = {
            changes: [
                { id: 'a', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'b', beat: 8, tempo: 140, curve: 'linear' },
            ],
        };
        subject.updateTempoChange('a', 5);
        const result = setMock.mock.calls[0]![0]!;
        // 'a' clamped up to 20; 'b' untouched (false-arm of the ternary).
        expect(result.changes[0]).toEqual({ id: 'a', beat: 0, tempo: 20, curve: 'instant' });
        expect(result.changes[1]).toEqual({ id: 'b', beat: 8, tempo: 140, curve: 'linear' });
    });

    it('clamps an over-range tempo down to the maximum', () => {
        mockStore.value = {
            changes: [{ id: 'a', beat: 0, tempo: 120, curve: 'instant' }],
        };
        subject.updateTempoChange('a', 9999);
        const result = setMock.mock.calls[0]![0]!;
        expect(result.changes[0]!.tempo).toBe(999);
    });

    it('preserves an in-range tempo verbatim', () => {
        mockStore.value = {
            changes: [{ id: 'a', beat: 0, tempo: 120, curve: 'instant' }],
        };
        subject.updateTempoChange('a', 90);
        const result = setMock.mock.calls[0]![0]!;
        expect(result.changes[0]!.tempo).toBe(90);
    });

    it('is a no-op (for set) when the tempo map store has no state', () => {
        // Defensive guard: a null store snapshot must not throw, must not call set.
        mockStore.value = null;
        subject.updateTempoChange('a', 120);
        expect(setMock).not.toHaveBeenCalled();
    });
});
