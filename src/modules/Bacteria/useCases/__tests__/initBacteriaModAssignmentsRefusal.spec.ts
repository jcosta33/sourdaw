import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { bacteriaStore, setBacteriaModAssignments } from '../../stores/bacteriaStore';
import { initBacteriaModAssignmentsPersistence } from '../initBacteriaModAssignmentsPersistence';

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

const DEVICE_ID = 'bacteria-1';

function row(amount: number) {
    return { sourceId: 'lfo1', targetParam: 'band0_drive', amount, bipolar: true } as const;
}

describe('initBacteriaModAssignmentsPersistence on a refused project', () => {
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
        bacteriaStore.set({});
        stop = initBacteriaModAssignmentsPersistence();
    });

    afterEach(() => {
        process.off('unhandledRejection', record);
        stop();
        bacteriaStore.set({});
        agentProjectRepairStateStore.set(null);
        clearHandlerRegistry();
    });

    it('tells the user once for a sweep of routing edits and leaves no unhandled rejection', async () => {
        setBacteriaModAssignments(DEVICE_ID, [row(0)]);
        for (let step = 1; step <= 6; step++) {
            setBacteriaModAssignments(DEVICE_ID, [row(step / 10)]);
        }
        await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledTimes(1));
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(notifyUser).toHaveBeenCalledTimes(1);
        expect(vi.mocked(notifyUser).mock.calls[0]?.[1]).toBe('warning');
        expect(unhandled).toEqual([]);
    });
});
