import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { repairProjectData } from '../repairProjectData';

import type { executeAppAction } from '#/modules/Command/useCases';

const mocks = vi.hoisted(() => ({
    executeAppAction: vi.fn<typeof executeAppAction>(),
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeAppAction: mocks.executeAppAction,
    isAppActionConflictError: (error: unknown): boolean =>
        error instanceof Error && error.name === 'AppActionConflictError',
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

function setRepairRequired(): void {
    agentProjectRepairStateStore.set({
        audioGraphValid: true,
        detectedRevision: 'rev-1',
        inspectionAvailable: true,
        projectInvariantsValid: true,
        rawProjectRetained: true,
        repairCandidates: [{ kind: 'repair-project-invariants', targetIds: [] }],
        status: 'repair-required',
    });
}

describe('repairProjectData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        agentProjectRepairStateStore.set(null);
    });

    afterEach(() => {
        agentProjectRepairStateStore.set(null);
    });

    it('does not dispatch when no repair is required', async () => {
        await expect(repairProjectData()).resolves.toBe('nothing-to-repair');

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(notifyUser).not.toHaveBeenCalled();
    });

    it('dispatches the admitted repair action and reports the outcome', async () => {
        setRepairRequired();
        mocks.executeAppAction.mockResolvedValue(undefined);

        await expect(repairProjectData()).resolves.toBe('repaired');

        expect(mocks.executeAppAction).toHaveBeenCalledWith({ type: 'repairProjectData' }, { source: 'manual' });
        expect(notifyUser).toHaveBeenCalledWith('Project repaired - editing and saving are re-enabled', 'success');
    });

    it('turns a refused repair into a warning instead of a rejected promise', async () => {
        setRepairRequired();
        mocks.executeAppAction.mockImplementation(async () => {
            // Refusals arrive as AppActionConflictError from dispatch; build a
            // genuine one through the exported predicate's class by driving the
            // real conflict path: a rejected promise of that type.
            const { default: none } = { default: undefined } as never;
            void none;
            throw conflictError();
        });

        await expect(repairProjectData()).resolves.toBe('refused');

        expect(notifyUser).toHaveBeenCalledWith(
            'The repair could not clear the problem - ask the assistant to repair the project',
            'warning'
        );
    });

    it('propagates a real failure unchanged', async () => {
        setRepairRequired();
        mocks.executeAppAction.mockRejectedValue(new Error('handler crashed'));

        await expect(repairProjectData()).rejects.toThrow('handler crashed');
        expect(notifyUser).not.toHaveBeenCalled();
    });
});

/**
 * A dispatch-shaped conflict error. The mocked barrel's predicate matches by
 * error name, so this is indistinguishable from a genuine refusal.
 */
function conflictError(): Error {
    const error = new Error('Action conflicts with current project state: repairProjectData');
    error.name = 'AppActionConflictError';
    return error;
}
