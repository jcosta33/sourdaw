import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTrackState, sanitizeTrackSnapshot, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import { resetCrdtProjectAuthority } from '#/modules/CrdtDocument/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { fromBacteriaModAssignmentsState } from '../../models/BacteriaModAssignmentsState';
import { type BacteriaModAssignment } from '../../models/BacteriaPatch';
import { bacteriaStore, setBacteriaModAssignments } from '../../stores/bacteriaStore';
import { initBacteriaModAssignmentsPersistence } from '../initBacteriaModAssignmentsPersistence';

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

const DEVICE_ID = 'bacteria-1';

function row(overrides: Partial<BacteriaModAssignment> = {}): BacteriaModAssignment {
    return { sourceId: 'lfo1', targetParam: 'band0_drive', amount: 0.5, bipolar: true, ...overrides };
}

function makeBacteriaTracks() {
    return sanitizeTrackSnapshot({
        tracks: [
            {
                id: 'track-1',
                name: 'Fx',
                kind: 'midi',
                devices: [{ id: DEVICE_ID, name: 'Bacteria', type: 'bacteria', bypassed: false, parameterValues: {} }],
            },
        ],
        selectedTrackId: null,
    }).tracks;
}

const lock = () =>
    agentProjectRepairStateStore.set({
        audioGraphValid: false,
        detectedRevision: 'revision-1',
        inspectionAvailable: true,
        projectInvariantsValid: false,
        rawProjectRetained: true,
        repairCandidates: [],
        status: 'repair-required',
    });
const unlock = () => agentProjectRepairStateStore.set(null);
const documentRows = () => fromBacteriaModAssignmentsState(trackStore.value?.tracks[0]?.devices[0]?.deviceState);

describe('initBacteriaModAssignmentsPersistence on a refused project', () => {
    let stopPersistence: () => void;

    beforeEach(() => {
        vi.clearAllMocks();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        trackStore.set({ ...defaultTrackState, tracks: makeBacteriaTracks() });
        lock();
        bacteriaStore.set({});
        stopPersistence = initBacteriaModAssignmentsPersistence();
        // First sight of the device records its baseline without committing.
        setBacteriaModAssignments(DEVICE_ID, []);
    });

    afterEach(() => {
        stopPersistence();
        bacteriaStore.set({});
        unlock();
    });

    it('writes the refused table once the project is unlocked, without a further edit', async () => {
        setBacteriaModAssignments(DEVICE_ID, [row()]);
        await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledTimes(1));
        expect(documentRows()).toBeNull();

        unlock();

        await vi.waitFor(() => expect(documentRows()).toEqual([row()]));
    });

    it('tells the user again after the device leaves the store and returns', async () => {
        setBacteriaModAssignments(DEVICE_ID, [row()]);
        await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledTimes(1));

        bacteriaStore.set({});
        setBacteriaModAssignments(DEVICE_ID, []);
        setBacteriaModAssignments(DEVICE_ID, [row({ amount: 0.25 })]);

        await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledTimes(2));
    });

    it('does not write a refused table into the project that replaced the one it was refused in', async () => {
        setBacteriaModAssignments(DEVICE_ID, [row()]);
        await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledTimes(1));

        // A load installs the new root, then clears the repair state; the new project holds the same device id.
        resetCrdtProjectAuthority('Replacement');
        trackStore.set({ ...defaultTrackState, tracks: makeBacteriaTracks() });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(agentProjectRepairStateStore.value).toBeNull();
        expect(documentRows()).toBeNull();
    });

    it('writes nothing on unlock when the table was edited back to what the document holds', async () => {
        setBacteriaModAssignments(DEVICE_ID, [row()]);
        await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledTimes(1));
        setBacteriaModAssignments(DEVICE_ID, []);
        const dispatched = vi.spyOn(trackStore, 'set');

        unlock();
        await new Promise<void>((resolve) => queueMicrotask(resolve));

        expect(dispatched).not.toHaveBeenCalled();
        expect(documentRows()).toBeNull();
    });
});
