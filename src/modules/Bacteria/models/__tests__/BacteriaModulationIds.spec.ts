import { describe, it, expect } from 'vitest';

import {
    bacteriaModSourceId,
    bacteriaModTargetId,
    bacteriaModulationTargetChoices,
    mapBacteriaModAssignments,
} from '../BacteriaModulationIds';
import { type BacteriaModAssignment } from '../BacteriaPatch';

describe('bacteriaModSourceId', () => {
    it('maps the dock source ids onto the engine source table', () => {
        expect(bacteriaModSourceId('lfo1')).toBe(0);
        expect(bacteriaModSourceId('lfo2')).toBe(1);
        expect(bacteriaModSourceId('env')).toBe(2);
        expect(bacteriaModSourceId('lorenz')).toBe(3);
        expect(bacteriaModSourceId('stepseq')).toBe(5);
        expect(bacteriaModSourceId('macro1')).toBe(6);
        expect(bacteriaModSourceId('macro8')).toBe(13);
    });

    it('maps an unknown source to null rather than to a nearest guess', () => {
        expect(bacteriaModSourceId('vibrato')).toBeNull();
    });
});

describe('bacteriaModTargetId', () => {
    it('maps global mix to target 0', () => {
        expect(bacteriaModTargetId('mix')).toBe(0);
    });

    it('maps per-band gains to targets 1-6', () => {
        expect(bacteriaModTargetId('band0_gain')).toBe(1);
        expect(bacteriaModTargetId('band5_gain')).toBe(6);
    });

    it('maps per-band drive and filter cutoff into their module strides', () => {
        expect(bacteriaModTargetId('band0_drive')).toBe(16);
        expect(bacteriaModTargetId('band0_filterCutoff')).toBe(17);
        expect(bacteriaModTargetId('band5_drive')).toBe(96);
        expect(bacteriaModTargetId('band5_filterCutoff')).toBe(97);
    });

    it('refuses names outside the grammar instead of retargeting them', () => {
        expect(bacteriaModTargetId('drive')).toBeNull();
        expect(bacteriaModTargetId('filterCutoff')).toBeNull();
        expect(bacteriaModTargetId('band6_drive')).toBeNull();
        expect(bacteriaModTargetId('band0_grainPitch')).toBeNull();
        expect(bacteriaModTargetId('')).toBeNull();
    });
});

describe('mapBacteriaModAssignments', () => {
    it('scales each amount into the target family offset units', () => {
        const table: BacteriaModAssignment[] = [
            { sourceId: 'lfo1', targetParam: 'mix', amount: 0.5, bipolar: true },
            { sourceId: 'macro1', targetParam: 'band0_drive', amount: 1, bipolar: false },
            { sourceId: 'lfo2', targetParam: 'band1_filterCutoff', amount: 0.1, bipolar: true },
        ];
        expect(mapBacteriaModAssignments(table)).toEqual([
            { sourceId: 0, targetParam: 0, amount: 0.5 },
            { sourceId: 6, targetParam: 16, amount: 100 },
            { sourceId: 1, targetParam: 33, amount: 19_980 * 0.1 },
        ]);
    });

    it('rejects the whole table when any row is unmappable (all-or-nothing replacement)', () => {
        const table: BacteriaModAssignment[] = [
            { sourceId: 'lfo1', targetParam: 'band0_drive', amount: 0.5, bipolar: true },
            { sourceId: 'lfo2', targetParam: 'drive', amount: 0.5, bipolar: true },
        ];
        expect(mapBacteriaModAssignments(table)).toBeNull();
    });

    it('maps an empty table to an empty engine table', () => {
        expect(mapBacteriaModAssignments([])).toEqual([]);
    });

    // The wire and the live worklet both carry `amount` as an `f32`. A scaled
    // amount this far out of range would otherwise reach the native door as a
    // finite JSON double that only turns into `f32::INFINITY` once the far
    // side narrows it — refusing the whole batch that carries it, not just
    // this table (#4685 slice 2). Refusing here first keeps that a per-table
    // refusal on both carriers.
    it('rejects the whole table when a scaled amount overflows f32 range', () => {
        const table: BacteriaModAssignment[] = [{ sourceId: 'lfo1', targetParam: 'band0_gain', amount: 1e39, bipolar: true }];
        expect(mapBacteriaModAssignments(table)).toBeNull();
    });

    it('keeps a scaled amount exactly within f32 range unchanged', () => {
        const table: BacteriaModAssignment[] = [{ sourceId: 'lfo1', targetParam: 'band0_gain', amount: 3e38, bipolar: true }];
        expect(mapBacteriaModAssignments(table)).toEqual([{ sourceId: 0, targetParam: 1, amount: 3e38 }]);
    });
});

describe('bacteriaModulationTargetChoices', () => {
    it('offers mix plus each active band drive and cutoff', () => {
        const ids = bacteriaModulationTargetChoices(2).map((choice) => choice.id);
        expect(ids).toEqual(['mix', 'band0_drive', 'band0_filterCutoff', 'band1_drive', 'band1_filterCutoff']);
    });

    it('clamps the band count to the engine six bands', () => {
        const ids = bacteriaModulationTargetChoices(9).map((choice) => choice.id);
        expect(ids.filter((id) => id.startsWith('band'))).toHaveLength(12);
    });

    it('offers nothing but mix when no band is active', () => {
        expect(bacteriaModulationTargetChoices(0).map((choice) => choice.id)).toEqual(['mix']);
    });
});
