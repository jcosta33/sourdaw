import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { AppActionAdmissionRefusedError, AppActionConflictError } from '../../errors/AppActionExecutionError';
import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { executeAppAction } from '../executeAppAction';
import { isAppActionAdmissionRefusal } from '../isAppActionAdmissionRefusal';
import { isAppActionConflictError } from '../isAppActionConflictError';
import { productionBriefAdmissionPort } from '../productionBriefAdmissionPort';

type SetEditingToolAction = Extract<AppAction, { type: 'setEditingTool' }>;

const repairRequired = {
    audioGraphValid: false,
    detectedRevision: 'revision-1',
    inspectionAvailable: true,
    projectInvariantsValid: false,
    rawProjectRetained: true,
    repairCandidates: [],
    status: 'repair-required',
} as const;

/** A handler that changes a gate while it runs: after the preflight admitted it, before the commit re-checks. */
function registerGateChangingHandler(changeGate: () => void): void {
    registerHandlerMap({
        setEditingTool: {
            undoable: false,
            describe: () => ({ label: 'Set editing tool' }),
            execute: async () => {
                await Promise.resolve();
                changeGate();
            },
        } satisfies ActionHandler<SetEditingToolAction>,
    });
}

const action = {
    type: 'setDeviceState',
    payload: { deviceId: 'device-1', state: { version: 1, data: {} } },
} as const;

async function rejection(dispatched: AppAction = action): Promise<unknown> {
    try {
        await executeAppAction(dispatched);
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

    it('refuses with the admission subclass when repair becomes required between preflight and commit', async () => {
        registerGateChangingHandler(() => agentProjectRepairStateStore.set(repairRequired));

        const error = await rejection({ type: 'setEditingTool', payload: { tool: 'marquee' } });

        expect(error).toBeInstanceOf(AppActionAdmissionRefusedError);
    });

    it('refuses with the admission subclass when the production brief locks between preflight and commit', async () => {
        let briefAllows = true;
        productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => briefAllows }));
        registerGateChangingHandler(() => {
            briefAllows = false;
        });

        const error = await rejection({ type: 'setEditingTool', payload: { tool: 'marquee' } });

        expect(error).toBeInstanceOf(AppActionAdmissionRefusedError);
    });

    it('commits when neither gate changes while the handler runs', async () => {
        registerGateChangingHandler(() => undefined);

        await expect(
            executeAppAction({ type: 'setEditingTool', payload: { tool: 'marquee' } })
        ).resolves.toBeUndefined();
    });

    it('does not take a handler conflict for an admission refusal', () => {
        expect(isAppActionAdmissionRefusal(new AppActionConflictError('detectTransients', 'failed'))).toBe(false);
    });
});
