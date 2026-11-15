import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { crumbsStore, ensureInstance, setMode } from '../../stores/crumbsStore';
import { initCrumbsDeviceStatePersistence } from '../initCrumbsDeviceStatePersistence';

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

const DEVICE_ID = 'crumbs-1';

describe('initCrumbsDeviceStatePersistence on a refused project', () => {
    let stop: () => void;
    const unhandled: unknown[] = [];
    const record = (reason: unknown): void => {
        unhandled.push(reason);
    };

    beforeEach(() => {
        vi.clearAllMocks();
        unhandled.length = 0;
        process.on('unhandledRejection', record);
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        agentProjectRepairStateStore.set({
            audioGraphValid: false,
            detectedRevision: 'revision-1',
            inspectionAvailable: true,
            projectInvariantsValid: false,
            rawProjectRetained: true,
            repairCandidates: [],
            status: 'repair-required',
        });
        crumbsStore.set({});
        stop = initCrumbsDeviceStatePersistence();
        ensureInstance(DEVICE_ID);
    });

    afterEach(() => {
        process.off('unhandledRejection', record);
        stop();
        crumbsStore.set({});
        agentProjectRepairStateStore.set(null);
        clearHandlerRegistry();
    });

    it('tells the user once for a sweep of mode switches and leaves no unhandled rejection', async () => {
        for (const mode of ['drum', 'slice', 'warp', 'drum', 'slice'] as const) {
            setMode(DEVICE_ID, mode);
        }
        await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledTimes(1));
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(notifyUser).toHaveBeenCalledTimes(1);
        expect(vi.mocked(notifyUser).mock.calls[0]?.[1]).toBe('warning');
        expect(unhandled).toEqual([]);
    });
});
