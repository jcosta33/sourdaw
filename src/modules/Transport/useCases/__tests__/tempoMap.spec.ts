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

vi.mock('../../stores/tempoMapStore', () => ({
    tempoMapStore: {
        get value() {
            return mockStore.value;
        },
        set: setMock,
    },
}));

vi.mock('../../models/TempoMap', () => ({
    createTempoChange: vi.fn((beat: number, tempo: number, curve: string) => ({
        id: `tc-${beat}`,
        beat,
        tempo,
        curve,
    })),
}));

import { addTempoChange } from '../tempoMap/addTempoChange';
import { removeTempoChange } from '../tempoMap/removeTempoChange';
import { updateTempoChange } from '../tempoMap/updateTempoChange';

describe('tempoMap', () => {
    beforeEach(() => {
        mockStore.value = { changes: [] };
        setMock.mockClear();
    });

    it('addTempoChange appends and sorts by beat', () => {
        mockStore.value = { changes: [{ id: 'c1', beat: 8, tempo: 100, curve: 'instant' }] };
        addTempoChange(4, 120);
        const result = setMock.mock.calls[0]![0]!;
        expect(result.changes.map((c) => c.beat)).toEqual([4, 8]);
    });

    it('addTempoChange replaces an existing entry at the same beat', () => {
        mockStore.value = { changes: [{ id: 'c1', beat: 4, tempo: 100, curve: 'instant' }] };
        addTempoChange(4, 140, 'linear');
        const result = setMock.mock.calls[0]![0]!;
        expect(result.changes).toHaveLength(1);
        expect(result.changes[0]!.tempo).toBe(140);
        expect(result.changes[0]!.curve).toBe('linear');
    });

    it('removeTempoChange filters by id', () => {
        mockStore.value = {
            changes: [
                { id: 'c1', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'c2', beat: 8, tempo: 140, curve: 'instant' },
            ],
        };
        removeTempoChange('c1');
        expect(setMock.mock.calls[0]![0]!.changes.map((c) => c.id)).toEqual(['c2']);
    });

    it('updateTempoChange clamps tempo to [20, 999]', () => {
        mockStore.value = { changes: [{ id: 'c1', beat: 0, tempo: 120, curve: 'instant' }] };
        updateTempoChange('c1', 1500);
        expect(setMock.mock.calls[0]![0]!.changes[0]!.tempo).toBe(999);
        setMock.mockClear();
        mockStore.value = { changes: [{ id: 'c1', beat: 0, tempo: 120, curve: 'instant' }] };
        updateTempoChange('c1', 5);
        expect(setMock.mock.calls[0]![0]!.changes[0]!.tempo).toBe(20);
    });
});
