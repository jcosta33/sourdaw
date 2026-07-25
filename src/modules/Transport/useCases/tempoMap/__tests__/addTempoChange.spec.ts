import { describe, it, expect, vi, beforeEach } from 'vitest';

const { setMock, mockStore } = vi.hoisted(() => {
    const ref = {
        value: { changes: [] as { id: string; beat: number; tempo: number; curve: 'instant' | 'linear' }[] } as {
            changes: { id: string; beat: number; tempo: number; curve: 'instant' | 'linear' }[];
        } | null,
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

vi.mock('../../../models/TempoMap', () => ({
    createTempoChange: vi.fn((beat: number, tempo: number, curve: string) => ({
        id: `tc-${beat}`,
        beat,
        tempo,
        curve,
    })),
}));

import * as subject from '../addTempoChange';

describe('addTempoChange', () => {
    beforeEach(() => {
        mockStore.value = { changes: [] };
        setMock.mockClear();
    });

    it('should export addTempoChange', () => {
        expect(subject.addTempoChange).toBeDefined();
        const time = typeof subject.addTempoChange;
        expect(time === 'function' || time === 'object').toBe(true);
    });

    it('updates an existing change whose beat drifted by a sub-tick amount instead of duplicating it', () => {
        // A save/load round-trip can perturb a stored beat below one tick (1/480).
        // Strict float `===` would miss it and append a duplicate; the epsilon match
        // must treat 8 + 1e-9 as the same change and update it in place.
        mockStore.value = { changes: [{ id: 'c1', beat: 8 + 1e-9, tempo: 100, curve: 'instant' }] };
        subject.addTempoChange(8, 140, 'linear');
        const result = setMock.mock.calls[0]![0]!;
        expect(result.changes).toHaveLength(1);
        expect(result.changes[0]!.tempo).toBe(140);
        expect(result.changes[0]!.curve).toBe('linear');
    });

    it('still inserts a distinct change at a different beat', () => {
        mockStore.value = { changes: [{ id: 'c1', beat: 8, tempo: 100, curve: 'instant' }] };
        subject.addTempoChange(4, 120);
        const result = setMock.mock.calls[0]![0]!;
        expect(result.changes.map((context) => context.beat)).toEqual([4, 8]);
    });

    it('is a no-op when the tempo map store has no state', () => {
        // Defensive guard against a null store snapshot (e.g. before initial load):
        // must not throw on the optional-chain, must not call set.
        mockStore.value = null;
        subject.addTempoChange(4, 120);
        expect(setMock).not.toHaveBeenCalled();
    });

    it('defaults the curve to instant when omitted', () => {
        mockStore.value = { changes: [] };
        subject.addTempoChange(0, 120);
        const result = setMock.mock.calls[0]![0]!;
        expect(result.changes[0]!.curve).toBe('instant');
    });

    it('keeps unrelated changes untouched when updating an existing beat', () => {
        // Exercises the ternary false-arm (index !== existing returns the
        // original context unchanged) alongside the update path.
        mockStore.value = {
            changes: [
                { id: 'c1', beat: 4, tempo: 100, curve: 'instant' },
                { id: 'c2', beat: 8, tempo: 140, curve: 'linear' },
            ],
        };
        subject.addTempoChange(4, 120, 'linear');
        const result = setMock.mock.calls[0]![0]!;
        expect(result.changes).toHaveLength(2);
        expect(result.changes[0]).toEqual({ id: 'c1', beat: 4, tempo: 120, curve: 'linear' });
        expect(result.changes[1]).toEqual({ id: 'c2', beat: 8, tempo: 140, curve: 'linear' });
    });
});
