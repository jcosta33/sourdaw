import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';

import { AppActionAdmissionRefusedError, AppActionConflictError } from '../../errors/AppActionExecutionError';
import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { executeAppAction } from '../executeAppAction';
import { isAppActionAdmissionRefusal } from '../isAppActionAdmissionRefusal';
import { isAppActionConflictError } from '../isAppActionConflictError';
import { productionBriefAdmissionPort } from '../productionBriefAdmissionPort';

const action = {
    type: 'setDeviceState',
    payload: { deviceId: 'device-1', state: { version: 1, data: {} } },
} as const;

async function rejection(): Promise<unknown> {
    try {
        await executeAppAction(action);
    } catch (error) {
        return error;
    }
    throw new Error('Expected the dispatch to be refused');
}

describe('executeAppAction admission refusal', () => {
    beforeEach(() => {
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => true }));
    });

    afterEach(() => {
        agentProjectRepairStateStore.set(null);
        productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => true }));
    });

    it('refuses a repair-required project with the admission subclass, still a conflict', async () => {
        agentProjectRepairStateStore.set({
            audioGraphValid: false,
            detectedRevision: 'revision-1',
            inspectionAvailable: true,
            projectInvariantsValid: false,
            rawProjectRetained: true,
            repairCandidates: [],
            status: 'repair-required',
        });

        const error = await rejection();

        expect(error).toBeInstanceOf(AppActionAdmissionRefusedError);
        expect(isAppActionAdmissionRefusal(error)).toBe(true);
        expect(isAppActionConflictError(error)).toBe(true);
        expect((error as Error).name).toBe('AppActionConflictError');
    });

    it('refuses a repair-required project before capturing the production brief footprint', async () => {
        const capture = vi.fn(() => ({ allowsCurrent: () => true }));
        productionBriefAdmissionPort.setGuard(capture);
        agentProjectRepairStateStore.set({
            audioGraphValid: false,
            detectedRevision: 'revision-1',
            inspectionAvailable: true,
            projectInvariantsValid: false,
            rawProjectRetained: true,
            repairCandidates: [],
            status: 'repair-required',
        });

        expect(isAppActionAdmissionRefusal(await rejection())).toBe(true);
        expect(capture).not.toHaveBeenCalled();
    });

    it('refuses a production-brief-locked project with the admission subclass', async () => {
        productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => false }));

        expect(isAppActionAdmissionRefusal(await rejection())).toBe(true);
    });

    it('does not take a handler conflict for an admission refusal', () => {
        expect(isAppActionAdmissionRefusal(new AppActionConflictError('detectTransients', 'failed'))).toBe(false);
    });
});
