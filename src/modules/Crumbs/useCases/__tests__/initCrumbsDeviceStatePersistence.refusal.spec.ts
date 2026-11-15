import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTrackState, sanitizeTrackSnapshot, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { fromCrumbsDeviceState } from '../../models/CrumbsDeviceState';
import { crumbsStore, ensureInstance, setMode } from '../../stores/crumbsStore';
import { initCrumbsDeviceStatePersistence } from '../initCrumbsDeviceStatePersistence';

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

const DEVICE_ID = 'crumbs-1';

function makeCrumbsTracks() {
    return sanitizeTrackSnapshot({
        tracks: [
            {
                id: 'track-1',
                name: 'Sampler',
                kind: 'midi',
                devices: [{ id: DEVICE_ID, name: 'Crumbs', type: 'crumbs', bypassed: false, parameterValues: {} }],
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
const documentMode = () => fromCrumbsDeviceState(trackStore.value?.tracks[0]?.devices[0]?.deviceState)?.mode;

describe('initCrumbsDeviceStatePersistence on a refused project', () => {
    let stopPersistence: () => void;

    beforeEach(() => {
        vi.clearAllMocks();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        trackStore.set({ ...defaultTrackState, tracks: makeCrumbsTracks() });
        lock();
        crumbsStore.set({});
        stopPersistence = initCrumbsDeviceStatePersistence();
        ensureInstance(DEVICE_ID);
    });

    afterEach(() => {
        stopPersistence();
        crumbsStore.set({});
        unlock();
    });

    it('writes the refused mode once the project is unlocked, without a further edit', async () => {
        setMode(DEVICE_ID, 'slice');
        await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledTimes(1));
        expect(documentMode()).toBeUndefined();

        unlock();

        await vi.waitFor(() => expect(documentMode()).toBe('slice'));
    });

    it('tells the user again after the device leaves the store and returns', async () => {
        setMode(DEVICE_ID, 'slice');
        await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledTimes(1));

        crumbsStore.set({});
        ensureInstance(DEVICE_ID);
        setMode(DEVICE_ID, 'warp');

        await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledTimes(2));
    });
});
