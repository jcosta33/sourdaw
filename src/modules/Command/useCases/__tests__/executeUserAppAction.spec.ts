import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { AppActionConflictError, AppActionNotDispatchedError } from '../../errors/AppActionExecutionError';
import { executeAppAction } from '../executeAppAction';
import { executeUserAppAction } from '../executeUserAppAction';
import { PROJECT_REPAIR_REQUIRED_MESSAGE } from '../isProjectMutationAllowed';

vi.mock('../executeAppAction', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../executeAppAction')>()),
    executeAppAction: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

describe('executeUserAppAction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        agentProjectRepairStateStore.set(null);
        vi.mocked(executeAppAction).mockResolvedValue(undefined);
    });

    afterEach(() => {
        agentProjectRepairStateStore.set(null);
    });

    it('turns a refusal into one warning notification and resolves', async () => {
        vi.mocked(executeAppAction).mockRejectedValueOnce(new AppActionConflictError('addTrack'));

        await expect(
            executeUserAppAction({ type: 'addTrack', payload: { name: 'New track', kind: 'audio' } })
        ).resolves.toBeUndefined();

        expect(notifyUser).toHaveBeenCalledTimes(1);
        expect(notifyUser).toHaveBeenCalledWith(
            "Add track was refused because the project can't be changed right now.",
            'warning'
        );
    });

    it('humanizes the label of an action type missing from ACTION_LABELS', async () => {
        vi.mocked(executeAppAction).mockRejectedValueOnce(new AppActionConflictError('addSidechainRoute'));

        await executeUserAppAction({
            type: 'addSidechainRoute',
            payload: { sourceTrackId: 'source', targetTrackId: 'target' },
        });

        expect(notifyUser).toHaveBeenCalledWith(
            "Add sidechain route was refused because the project can't be changed right now.",
            'warning'
        );
        expect(vi.mocked(notifyUser).mock.calls[0]?.[0]).not.toContain('addSidechainRoute');
    });

    it('reports the repair requirement when that is what closed the gate', async () => {
        agentProjectRepairStateStore.set({
            audioGraphValid: false,
            detectedRevision: 'revision-1',
            inspectionAvailable: true,
            projectInvariantsValid: false,
            rawProjectRetained: true,
            repairCandidates: [],
            status: 'repair-required',
        });
        vi.mocked(executeAppAction).mockRejectedValueOnce(new AppActionConflictError('addTrack'));

        await executeUserAppAction({ type: 'addTrack', payload: { name: 'New track', kind: 'audio' } });

        expect(notifyUser).toHaveBeenCalledWith(PROJECT_REPAIR_REQUIRED_MESSAGE, 'warning');
    });

    it('rethrows every failure that is not a refusal', async () => {
        const error = new AppActionNotDispatchedError('addTrack');
        vi.mocked(executeAppAction).mockRejectedValueOnce(error);

        await expect(
            executeUserAppAction({ type: 'addTrack', payload: { name: 'New track', kind: 'audio' } })
        ).rejects.toBe(error);

        expect(notifyUser).not.toHaveBeenCalled();
    });

    it('says nothing when the action executes', async () => {
        await executeUserAppAction({ type: 'addTrack', payload: { name: 'New track', kind: 'audio' } });

        expect(executeAppAction).toHaveBeenCalledWith(
            { type: 'addTrack', payload: { name: 'New track', kind: 'audio' } },
            undefined
        );
        expect(notifyUser).not.toHaveBeenCalled();
    });
});
