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

describe('setBacteriaModAssignmentsWithAudio', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('updates the store and pushes the whole mapped table through the patch door', () => {
        const deps = makeDeps();
        const table = [
            assignment(),
            assignment({ sourceId: 'macro1', targetParam: 'band1_filterCutoff', amount: 0.2, bipolar: false }),
        ];

        setBacteriaModAssignmentsWithAudio(deps as never)(DEVICE_ID, table);

        expect(setBacteriaModAssignments).toHaveBeenCalledWith(DEVICE_ID, table);
        expect(deps.updateDevicePatch).toHaveBeenCalledWith(TRACK_ID, DEVICE_ID, {
            modAssignments: [
                { sourceId: 0, targetParam: 16, amount: 50 },
                { sourceId: 6, targetParam: 33, amount: 19_980 * 0.2 },
            ],
        });
    });

    it('pushes an empty table so a remove that empties the list also silences the engine', () => {
        const deps = makeDeps();

        setBacteriaModAssignmentsWithAudio(deps as never)(DEVICE_ID, []);

        expect(setBacteriaModAssignments).toHaveBeenCalledWith(DEVICE_ID, []);
        expect(deps.updateDevicePatch).toHaveBeenCalledWith(TRACK_ID, DEVICE_ID, { modAssignments: [] });
    });

    it('updates the store but pushes nothing when a row has no engine mapping', () => {
        const deps = makeDeps();
        const table = [assignment({ targetParam: 'drive' })];

        setBacteriaModAssignmentsWithAudio(deps as never)(DEVICE_ID, table);

        expect(setBacteriaModAssignments).toHaveBeenCalledWith(DEVICE_ID, table);
        expect(deps.updateDevicePatch).not.toHaveBeenCalled();
    });

    it('does nothing when the device cannot accept engine writes', () => {
        const deps = makeDeps();
        deps.resolveEligibleDeviceWriteTarget.mockReturnValue({ status: 'ineligible', reason: 'no-device' });

        setBacteriaModAssignmentsWithAudio(deps as never)(DEVICE_ID, [assignment()]);

        expect(setBacteriaModAssignments).not.toHaveBeenCalled();
        expect(deps.updateDevicePatch).not.toHaveBeenCalled();
    });
});
