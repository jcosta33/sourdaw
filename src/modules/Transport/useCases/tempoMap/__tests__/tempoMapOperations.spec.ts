import { describe, it, expect, vi, beforeEach } from 'vitest';

let storeState: { changes: { id: string; beat: number; tempo: number; curve: string }[] } = { changes: [] };

vi.mock('../../../stores/tempoMapStore', () => ({
    tempoMapStore: {
        get value() {
            return storeState;
        },
        set: (next: typeof storeState) => {
            storeState = next;
        },
    },
}));

vi.mock('../../../models/TempoMap', () => ({
    createTempoChange: (beat: number, tempo: number, curve: string) => ({
        id: `tc-${beat}-${tempo}`,
        beat,
        tempo,
        curve,
    }),
}));

import { addTempoChange } from '../addTempoChange';
import { removeTempoChange } from '../removeTempoChange';
import { updateTempoChange } from '../updateTempoChange';

describe('tempo map operations', () => {
    beforeEach(() => {
        storeState = { changes: [] };
    });

    it('adds a new tempo change', () => {
        addTempoChange(0, 120);
        expect(storeState.changes).toHaveLength(1);
        expect(storeState.changes[0]!.tempo).toBe(120);
    });

    it('sorts changes by beat', () => {
        addTempoChange(8, 140);
        addTempoChange(0, 120);
        expect(storeState.changes[0]!.beat).toBe(0);
        expect(storeState.changes[1]!.beat).toBe(8);
    });

    it('updates existing change at same beat', () => {
        addTempoChange(4, 120);
        addTempoChange(4, 140);
        expect(storeState.changes).toHaveLength(1);
        expect(storeState.changes[0]!.tempo).toBe(140);
    });

    it('accepts curve parameter', () => {
        addTempoChange(0, 120, 'linear');
        expect(storeState.changes[0]!.curve).toBe('linear');
    });

    it('updateTempoChange modifies existing', () => {
        addTempoChange(0, 120);
        const id = storeState.changes[0]!.id;
        updateTempoChange(id, 160);
        expect(storeState.changes[0]!.tempo).toBe(160);
    });

    it('updateTempoChange clamps 20-999', () => {
        addTempoChange(0, 120);
        const id = storeState.changes[0]!.id;
        updateTempoChange(id, 5);
        expect(storeState.changes[0]!.tempo).toBe(20);
        updateTempoChange(id, 2000);
        expect(storeState.changes[0]!.tempo).toBe(999);
    });

    it('removeTempoChange removes by id', () => {
        addTempoChange(0, 120);
        addTempoChange(8, 140);
        const id = storeState.changes[0]!.id;
        removeTempoChange(id);
        expect(storeState.changes).toHaveLength(1);
        expect(storeState.changes[0]!.tempo).toBe(140);
    });
});
