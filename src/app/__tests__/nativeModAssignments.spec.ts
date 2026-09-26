/**
 * The composition-root dispatch a device's modulation-assignment table
 * projects through, the mirror of `projectNativeDeviceState.spec.ts` for the
 * one table a `parameterValues` record cannot carry (#4685 slice 2).
 *
 * Bacteria's own chunk decoding and mapping are `BacteriaModAssignmentsState`
 * and `BacteriaModulationIds`'s concern; this only proves the composition
 * root reaches them for `bacteria` and refuses nothing beyond what those
 * modules already refuse for every other native type. The chunk is written
 * out as the wire shape those modules read (`{ version, data: { modAssignments } }`)
 * rather than through a model import, because `src/app/` may cross a module
 * boundary only through its contract barrels.
 */

import { describe, expect, it } from 'vitest';

import { type DeviceStateChunk } from '#/modules/Arrangement/stores';

import { nativeModAssignments } from '../nativeModAssignments';

function chunkOf(
    rows: { sourceId: string; targetParam: string; amount: number; bipolar: boolean }[]
): DeviceStateChunk {
    return { version: 1, data: { modAssignments: rows } };
}

describe('nativeModAssignments', () => {
    it('maps a bacteria chunk carrying valid rows onto the engine grammar', () => {
        const deviceState = chunkOf([
            { sourceId: 'lfo1', targetParam: 'mix', amount: 0.5, bipolar: false },
            { sourceId: 'env', targetParam: 'band0_gain', amount: 0.3, bipolar: false },
        ]);

        const rows = nativeModAssignments({ deviceType: 'bacteria', deviceState });

        expect(rows).toEqual([
            { sourceId: 0, targetParam: 0, amount: 0.5 },
            { sourceId: 2, targetParam: 1, amount: 0.3 },
        ]);
    });

    it('answers null for a bacteria device with no committed chunk', () => {
        expect(nativeModAssignments({ deviceType: 'bacteria', deviceState: undefined })).toBeNull();
    });

    it('answers null for a bacteria table past the 64-row limit', () => {
        const rows = Array.from({ length: 65 }, () => ({
            sourceId: 'lfo1',
            targetParam: 'mix',
            amount: 0.1,
            bipolar: false,
        }));
        const deviceState = chunkOf(rows);

        expect(nativeModAssignments({ deviceType: 'bacteria', deviceState })).toBeNull();
    });

    it('answers null for a bacteria table carrying one unmappable row', () => {
        const deviceState = chunkOf([
            { sourceId: 'lfo1', targetParam: 'mix', amount: 0.5, bipolar: false },
            { sourceId: 'not-a-real-source', targetParam: 'mix', amount: 0.2, bipolar: false },
        ]);

        expect(nativeModAssignments({ deviceType: 'bacteria', deviceState })).toBeNull();
    });

    it('answers null for a non-bacteria device type', () => {
        const deviceState = chunkOf([{ sourceId: 'lfo1', targetParam: 'mix', amount: 0.5, bipolar: false }]);

        expect(nativeModAssignments({ deviceType: 'fermenter', deviceState })).toBeNull();
    });
});
