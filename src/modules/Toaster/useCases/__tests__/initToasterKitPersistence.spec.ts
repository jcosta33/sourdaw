import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTrackState, sanitizeTrackSnapshot, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { registerToasterDevice, toasterStore, toggleStep } from '../../stores/toasterStore';
import { initToasterKitPersistence } from '../initToasterKitPersistence';

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

const DEVICE_ID = 'toaster-1';

function makeToasterTracks() {
    return sanitizeTrackSnapshot({
        tracks: [
            {
                id: 'track-1',
                name: 'Drums',
                kind: 'midi',
                devices: [
                    {
                        id: DEVICE_ID,
                        name: 'Toaster',
                        type: 'toaster',
                        bypassed: false,
                        parameterValues: { masterGain: 1 },
                    },
                ],
            },
        ],
        selectedTrackId: null,
    }).tracks;
}

describe('initToasterKitPersistence on a refused project', () => {
    let stopPersistence: () => void;
    const unhandled: unknown[] = [];
    const recordUnhandled = (reason: unknown): void => {
        unhandled.push(reason);
    };

    beforeEach(() => {
        vi.clearAllMocks();
        unhandled.length = 0;
        process.on('unhandledRejection', recordUnhandled);
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        trackStore.set({ ...defaultTrackState, tracks: makeToasterTracks() });
        agentProjectRepairStateStore.set({
            audioGraphValid: false,
            detectedRevision: 'revision-1',
            inspectionAvailable: true,
            projectInvariantsValid: false,
            rawProjectRetained: true,
            repairCandidates: [],
            status: 'repair-required',
        });
        toasterStore.set({});
        stopPersistence = initToasterKitPersistence();
        registerToasterDevice(DEVICE_ID);
    });

    afterEach(() => {
        process.off('unhandledRejection', recordUnhandled);
        stopPersistence();
        toasterStore.set({});
        agentProjectRepairStateStore.set(null);
    });

    it('tells the user once for a sweep of kit edits and leaves no unhandled rejection', async () => {
        for (let step = 0; step < 8; step++) {
            toggleStep(DEVICE_ID, 0, step);
        }
        await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledTimes(1));
        // Let any rejected commit promises surface before asserting there are none.
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(notifyUser).toHaveBeenCalledTimes(1);
        expect(vi.mocked(notifyUser).mock.calls[0]?.[1]).toBe('warning');
        expect(unhandled).toEqual([]);
    });

    it('tells the user again after the device leaves the store and returns', async () => {
        toggleStep(DEVICE_ID, 0, 0);
        await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledTimes(1));

        toasterStore.set({});
        registerToasterDevice(DEVICE_ID);
        toggleStep(DEVICE_ID, 0, 1);

        await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledTimes(2));
    });
});
