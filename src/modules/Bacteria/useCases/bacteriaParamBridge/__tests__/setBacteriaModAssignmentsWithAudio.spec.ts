import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type BacteriaModAssignment } from '../../../models/BacteriaPatch';
import { setBacteriaModAssignments } from '../../../stores/bacteriaStore';
import { setBacteriaModAssignmentsWithAudio } from '../setBacteriaModAssignmentsWithAudio';

vi.mock('../../../stores/bacteriaStore', () => ({
    setBacteriaModAssignments: vi.fn(),
}));

vi.mock('#/infra/di/inject', () => ({
    inject: () => (fn: any) => fn,
}));

vi.mock('../bacteriaParamBridgeDependencies', () => ({
    bacteriaParamBridgeDependencies: {},
}));

// The engine half — mapping and the `updateDevicePatch` push — moved to
// `pushBacteriaModAssignmentsToEngine` (#4756), covered by its own spec.
// This mock's `resolveEligibleDeviceWriteTarget`, matching the extracted
// use case's own gate, keeps this file's "ineligible" case meaningful without
// re-testing the mapping it no longer performs.
vi.mock('../pushBacteriaModAssignmentsToEngine', () => ({
    pushBacteriaModAssignmentsToEngine: vi.fn(),
}));

import { pushBacteriaModAssignmentsToEngine } from '../pushBacteriaModAssignmentsToEngine';

const TRACK_ID = 'track-1';
const DEVICE_ID = 'device-1';

function makeDeps() {
    return {
        resolveEligibleDeviceWriteTarget: vi.fn().mockReturnValue({
            status: 'eligible',
            trackId: TRACK_ID,
            deviceId: DEVICE_ID,
        }),
    };
}

function assignment(overrides: Partial<BacteriaModAssignment> = {}): BacteriaModAssignment {
    return { sourceId: 'lfo1', targetParam: 'band0_drive', amount: 0.5, bipolar: true, ...overrides };
}

describe('setBacteriaModAssignmentsWithAudio', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('updates the store and hands the whole table to the engine push use case', () => {
        const deps = makeDeps();
        const table = [
            assignment(),
            assignment({ sourceId: 'macro1', targetParam: 'band1_filterCutoff', amount: 0.2, bipolar: false }),
        ];

        setBacteriaModAssignmentsWithAudio(deps as never)(DEVICE_ID, table);

        expect(setBacteriaModAssignments).toHaveBeenCalledWith(DEVICE_ID, table);
        expect(pushBacteriaModAssignmentsToEngine).toHaveBeenCalledWith(DEVICE_ID, table);
    });

    it('hands an empty table to the engine push use case so a remove that empties the list also silences the engine', () => {
        const deps = makeDeps();

        setBacteriaModAssignmentsWithAudio(deps as never)(DEVICE_ID, []);

        expect(setBacteriaModAssignments).toHaveBeenCalledWith(DEVICE_ID, []);
        expect(pushBacteriaModAssignmentsToEngine).toHaveBeenCalledWith(DEVICE_ID, []);
    });

    it('still delegates to the engine push use case for a table with no engine mapping — that gate moved with the mapping', () => {
        const deps = makeDeps();
        const table = [assignment({ targetParam: 'drive' })];

        setBacteriaModAssignmentsWithAudio(deps as never)(DEVICE_ID, table);

        expect(setBacteriaModAssignments).toHaveBeenCalledWith(DEVICE_ID, table);
        expect(pushBacteriaModAssignmentsToEngine).toHaveBeenCalledWith(DEVICE_ID, table);
    });

    it('does nothing when the device cannot accept engine writes', () => {
        const deps = makeDeps();
        deps.resolveEligibleDeviceWriteTarget.mockReturnValue({ status: 'ineligible', reason: 'no-device' });

        setBacteriaModAssignmentsWithAudio(deps as never)(DEVICE_ID, [assignment()]);

        expect(setBacteriaModAssignments).not.toHaveBeenCalled();
        expect(pushBacteriaModAssignmentsToEngine).not.toHaveBeenCalled();
    });
});
