import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type BacteriaModAssignment } from '../../../models/BacteriaPatch';
import { pushBacteriaModAssignmentsToEngine } from '../pushBacteriaModAssignmentsToEngine';

vi.mock('#/infra/di/inject', () => ({
    inject: () => (fn: any) => fn,
}));

vi.mock('../bacteriaParamBridgeDependencies', () => ({
    bacteriaParamBridgeDependencies: {},
}));

const TRACK_ID = 'track-1';
const DEVICE_ID = 'device-1';

function makeDeps() {
    return {
        updateDevicePatch: vi.fn(),
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

describe('pushBacteriaModAssignmentsToEngine', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('pushes the whole mapped table through the patch door', () => {
        const deps = makeDeps();
        const table = [
            assignment(),
            assignment({ sourceId: 'macro1', targetParam: 'band1_filterCutoff', amount: 0.2, bipolar: false }),
        ];

        pushBacteriaModAssignmentsToEngine(deps as never)(DEVICE_ID, table);

        expect(deps.updateDevicePatch).toHaveBeenCalledWith(TRACK_ID, DEVICE_ID, {
            modAssignments: [
                { sourceId: 0, targetParam: 16, amount: 50 },
                { sourceId: 6, targetParam: 33, amount: 19_980 * 0.2 },
            ],
        });
    });

    it('pushes an empty table so a remove that empties the list also silences the engine', () => {
        const deps = makeDeps();

        pushBacteriaModAssignmentsToEngine(deps as never)(DEVICE_ID, []);

        expect(deps.updateDevicePatch).toHaveBeenCalledWith(TRACK_ID, DEVICE_ID, { modAssignments: [] });
    });

    it('pushes nothing when a row has no engine mapping', () => {
        const deps = makeDeps();
        const table = [assignment({ targetParam: 'drive' })];

        pushBacteriaModAssignmentsToEngine(deps as never)(DEVICE_ID, table);

        expect(deps.updateDevicePatch).not.toHaveBeenCalled();
    });

    it('does nothing when the device cannot accept engine writes', () => {
        const deps = makeDeps();
        deps.resolveEligibleDeviceWriteTarget.mockReturnValue({ status: 'ineligible', reason: 'no-device' });

        pushBacteriaModAssignmentsToEngine(deps as never)(DEVICE_ID, [assignment()]);

        expect(deps.updateDevicePatch).not.toHaveBeenCalled();
    });
});
