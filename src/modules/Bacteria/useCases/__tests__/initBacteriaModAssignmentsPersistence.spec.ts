import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    executeAppAction: vi.fn(),
    hydrateBacteriaModAssignmentsFromProject: vi.fn(
        () => null as ReturnType<typeof hydrateBacteriaModAssignmentsFromProject>
    ),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
}));

vi.mock('../hydrateBacteriaModAssignmentsFromProject', () => ({
    hydrateBacteriaModAssignmentsFromProject: mocks.hydrateBacteriaModAssignmentsFromProject,
}));

import { type BacteriaModAssignment } from '../../models/BacteriaPatch';
import { bacteriaStore, setBacteriaModAssignments, updateBacteriaMeters } from '../../stores/bacteriaStore';
import { initBacteriaModAssignmentsPersistence } from '../initBacteriaModAssignmentsPersistence';

import type { hydrateBacteriaModAssignmentsFromProject } from '../hydrateBacteriaModAssignmentsFromProject';

const DEVICE_ID = 'bacteria-1';

function row(overrides: Partial<BacteriaModAssignment> = {}): BacteriaModAssignment {
    return { sourceId: 'lfo1', targetParam: 'band0_drive', amount: 0.5, bipolar: true, ...overrides };
}

describe('initBacteriaModAssignmentsPersistence', () => {
    let stop: () => void;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.hydrateBacteriaModAssignmentsFromProject.mockReturnValue(null);
        bacteriaStore.set({});
        stop = initBacteriaModAssignmentsPersistence();
    });

    afterEach(() => {
        stop();
        bacteriaStore.set({});
    });

    it('subscribes and returns an unsubscribe function', () => {
        expect(typeof stop).toBe('function');
    });

    it('does not commit on first sight of a device with a table', () => {
        setBacteriaModAssignments(DEVICE_ID, [row()]);

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
    });

    it('commits exactly one setDeviceState action when the table changes and differs from the document', () => {
        setBacteriaModAssignments(DEVICE_ID, [row()]);
        vi.clearAllMocks();
        mocks.hydrateBacteriaModAssignmentsFromProject.mockReturnValue([]);

        const nextRows = [row({ targetParam: 'band1_filterCutoff' })];
        setBacteriaModAssignments(DEVICE_ID, nextRows);

        expect(mocks.executeAppAction).toHaveBeenCalledExactlyOnceWith(
            {
                type: 'setDeviceState',
                payload: {
                    deviceId: DEVICE_ID,
                    state: { version: 1, data: { modAssignments: nextRows } },
                },
            },
            { skipMacroRecording: true }
        );
    });

    it('does not commit when the new table equals, row for row, the document decoded table', () => {
        setBacteriaModAssignments(DEVICE_ID, [row()]);
        vi.clearAllMocks();
        mocks.hydrateBacteriaModAssignmentsFromProject.mockReturnValue([row({ targetParam: 'band2_gain' })]);

        // A distinct array reference, but equal row for row to the mocked document.
        setBacteriaModAssignments(DEVICE_ID, [row({ targetParam: 'band2_gain' })]);

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
    });

    it('does not commit when only bandLevels changes (same modAssignments reference)', () => {
        setBacteriaModAssignments(DEVICE_ID, [row()]);
        vi.clearAllMocks();

        updateBacteriaMeters(DEVICE_ID, -6, -6, [0.1, 0.2, 0, 0, 0, 0]);

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
    });

    it('forgets a device that disappears, so a reused id is treated as first sight', () => {
        setBacteriaModAssignments(DEVICE_ID, [row()]);
        bacteriaStore.set({});
        vi.clearAllMocks();

        setBacteriaModAssignments(DEVICE_ID, [row()]);

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
    });
});
