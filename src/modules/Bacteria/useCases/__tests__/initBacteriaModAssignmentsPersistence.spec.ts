import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    executeAppAction: vi.fn(),
    pushUndoEntry: vi.fn(),
    hydrateBacteriaModAssignmentsFromProject: vi.fn(
        (_deviceId: string) => null as ReturnType<typeof hydrateBacteriaModAssignmentsFromProject>
    ),
}));

// `hydrateBacteriaPatchFromProject`'s real implementation pulls in the
// `Arrangement` stores barrel, which reaches `pushUndoEntry` through modules
// this spec never exercises (Automation, ElasticAudio); the barrel-mock
// coverage check needs it named here even though no test calls it.
vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
    pushUndoEntry: mocks.pushUndoEntry,
}));

vi.mock('../hydrateBacteriaModAssignmentsFromProject', () => ({
    hydrateBacteriaModAssignmentsFromProject: mocks.hydrateBacteriaModAssignmentsFromProject,
}));

import { trackStore } from '#/modules/Arrangement/stores';

import { type BacteriaModAssignment } from '../../models/BacteriaPatch';
import {
    bacteriaStore,
    getBacteriaState,
    setBacteriaModAssignments,
    setBacteriaUiLevel,
    updateBacteriaMeters,
} from '../../stores/bacteriaStore';
import { hydrateBacteriaPatchFromProject } from '../hydrateBacteriaPatchFromProject';
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
        trackStore.set(null);
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

    it('commits [r1, r2] when an edit builds on the table the panel hydration projected from the document (#4756)', async () => {
        // The real document read, not the canned mock: this is the one case
        // that must prove the load-subscriber-equality skip and the panel
        // hydration cooperate rather than fight, so both run for real.
        const actual = await vi.importActual<typeof import('../hydrateBacteriaModAssignmentsFromProject')>(
            '../hydrateBacteriaModAssignmentsFromProject'
        );
        mocks.hydrateBacteriaModAssignmentsFromProject.mockImplementation(
            actual.hydrateBacteriaModAssignmentsFromProject
        );

        const r1 = row();
        const r2 = row({ targetParam: 'band2_gain' });
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    devices: [
                        {
                            id: DEVICE_ID,
                            type: 'bacteria',
                            deviceState: { version: 1, data: { modAssignments: [r1] } },
                        },
                    ],
                },
            ],
        } as unknown as typeof trackStore.value);

        // First sight: the default empty table, not an edit.
        setBacteriaUiLevel(DEVICE_ID, 1);
        // Panel mount hydration: builds the table on top of the document's [r1]
        // rather than the store's still-empty one, and must not itself commit
        // since it only re-states what the document already holds.
        hydrateBacteriaPatchFromProject(DEVICE_ID);
        expect(mocks.executeAppAction).not.toHaveBeenCalled();

        // The routing-matrix edit: add r2 on top of the hydrated [r1].
        const table = getBacteriaState(DEVICE_ID).patch.modAssignments;
        setBacteriaModAssignments(DEVICE_ID, [...table, r2]);

        expect(mocks.executeAppAction).toHaveBeenCalledExactlyOnceWith(
            {
                type: 'setDeviceState',
                payload: {
                    deviceId: DEVICE_ID,
                    state: { version: 1, data: { modAssignments: [r1, r2] } },
                },
            },
            { skipMacroRecording: true }
        );
    });
});
