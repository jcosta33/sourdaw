import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutable store holders so each test can install a distinct snapshot graph
// without fighting vi.mock's hoisting.
const transportState: { value: Record<string, unknown> | null } = { value: null };
const tempoMapState: { value: { changes: unknown[] } | null } = { value: null };
const timeSigState: { value: { changes: unknown[] } | null } = { value: null };

vi.mock('../../stores/transportStore', () => ({
    transportStore: {
        get value() {
            return transportState.value;
        },
    },
}));
vi.mock('../../stores/tempoMapStore', () => ({
    tempoMapStore: {
        get value() {
            return tempoMapState.value;
        },
    },
}));
vi.mock('../../stores/timeSignatureMapStore', () => ({
    timeSignatureMapStore: {
        get value() {
            return timeSigState.value;
        },
    },
}));

import { createMusicalPositionProjector } from '../createMusicalPositionProjector';

describe('createMusicalPositionProjector', () => {
    beforeEach(() => {
        transportState.value = null;
        tempoMapState.value = null;
        timeSigState.value = null;
    });

    it('derives bar/beat/bpm from defaults when the stores are absent (all ?? fallbacks)', () => {
        const project = createMusicalPositionProjector();

        const pos = project(0);
        // Defaults: tempo 120, 4/4, no loop. Bar 1 beat 1 tick 0 → 0-based (0, 0).
        expect(pos.bpm).toBe(120);
        expect(pos.barIndex).toBe(0);
        expect(pos.beatInBar).toBe(0);
        expect(pos.timeSigNum).toBe(4);
        expect(pos.timeSigDen).toBe(4);
        expect(pos.loopEnabled).toBe(false);
        expect(pos.loopStartPpq).toBe(0);
        expect(pos.loopEndPpq).toBe(0);
    });

    it('reads transport fields directly and reports loopEnabled when loopStart < loopEnd', () => {
        transportState.value = {
            tempo: 90,
            timeSignatureNumerator: 3,
            timeSignatureDenominator: 8,
            loopStart: 960,
            loopEnd: 1920,
        };
        const project = createMusicalPositionProjector();

        const pos = project(0);
        expect(pos.bpm).toBe(90);
        expect(pos.timeSigNum).toBe(3);
        expect(pos.timeSigDen).toBe(8);
        expect(pos.loopEnabled).toBe(true); // 960 < 1920
        expect(pos.loopStartPpq).toBe(960);
        expect(pos.loopEndPpq).toBe(1920);
    });

    it('reports loopEnabled false when loopStart equals loopEnd (no loop region)', () => {
        transportState.value = { loopStart: 960, loopEnd: 960 };
        const project = createMusicalPositionProjector();
        expect(project(0).loopEnabled).toBe(false);
    });

    it('resolves bpm from the tempo change at the given beat', () => {
        transportState.value = { tempo: 120 };
        tempoMapState.value = {
            changes: [
                { id: 't0', beat: 0, tempo: 100, curve: 'instant' },
                { id: 't1', beat: 4, tempo: 140, curve: 'instant' },
            ],
        };
        const project = createMusicalPositionProjector();

        // Beat 2: previous change @0 (100), curve instant → 100. Beat 4 lands
        // on t1 → 140. The default (120) only applies when there are no changes.
        expect(project(2).bpm).toBe(100);
        expect(project(4).bpm).toBe(140);
    });

    it('computes 0-based barIndex and beatInBar including the tick fraction', () => {
        transportState.value = { tempo: 120, timeSignatureNumerator: 4, timeSignatureDenominator: 4 };
        const project = createMusicalPositionProjector();

        // 4/4, ppq 5.5 quarters → bar 2 (0-based 1), beat 2 in the bar
        // (quarters into bar 1.5 → beat 2 tick 240 → 0-based beat 1 + 0.5).
        const pos = project(5.5);
        expect(pos.barIndex).toBe(1);
        expect(pos.beatInBar).toBeCloseTo(1.5, 6);
    });

    it('snapshots a sorted tempo map stripped to {beat, tempo, curve}', () => {
        transportState.value = { tempo: 120 };
        tempoMapState.value = {
            changes: [
                // Delivered out of order with an extra field the projector drops.
                { id: 't1', beat: 4, tempo: 140, curve: 'instant', extra: 'drop' },
                { id: 't0', beat: 0, tempo: 100, curve: 'ramp' },
            ],
        };
        const project = createMusicalPositionProjector();

        const pos = project(0);
        expect(pos.tempoMap.defaultTempo).toBe(120);
        expect(pos.tempoMap.changes).toEqual([
            { beat: 0, tempo: 100, curve: 'ramp' },
            { beat: 4, tempo: 140, curve: 'instant' },
        ]);
    });

    it('freezes the tempo map at creation: later store mutations do not affect it', () => {
        tempoMapState.value = {
            changes: [{ id: 't0', beat: 0, tempo: 100, curve: 'instant' }],
        };
        transportState.value = { tempo: 120 };

        const project = createMusicalPositionProjector();
        const before = project(0).tempoMap.changes;

        // Mutate the live store after creation: the snapshot must be unchanged
        // (structuredClone at creation decouples it from the store reference).
        tempoMapState.value = {
            changes: [{ id: 't1', beat: 8, tempo: 200, curve: 'instant' }],
        };
        const after = project(0).tempoMap.changes;

        expect(after).toEqual(before);
        expect(after).toEqual([{ beat: 0, tempo: 100, curve: 'instant' }]);
    });

    it('resolves the time signature from a change at or before the beat', () => {
        transportState.value = { tempo: 120, timeSignatureNumerator: 4, timeSignatureDenominator: 4 };
        timeSigState.value = {
            changes: [{ id: 'ts1', beat: 4, numerator: 6, denominator: 8 }],
        };
        const project = createMusicalPositionProjector();

        // Before the change → default 4/4; at/after → 6/8.
        expect(project(0).timeSigNum).toBe(4);
        expect(project(0).timeSigDen).toBe(4);
        expect(project(4).timeSigNum).toBe(6);
        expect(project(4).timeSigDen).toBe(8);
    });
});
