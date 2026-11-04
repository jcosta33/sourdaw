import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    projectLoadEpoch,
    runProjectLoadTransaction,
} from '../../../projectPersistence/helpers/runProjectLoadTransaction';
import { reportDeviceReadiness } from '../reportDeviceReadiness';

const mocks = vi.hoisted(() => ({
    notifyUser: vi.fn(),
    leaveCollaborationSession: vi.fn(),
    whenProjectIdentityTransitionDependenciesConfigured: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));
vi.mock('#/modules/AudioEngine/useCases', () => ({ cancelPendingAudioBufferImport: vi.fn() }));
vi.mock('../../../projectPersistence/projectIdentityTransitionDependencies', () => ({
    projectIdentityTransitionDependencies: { leaveCollaborationSession: mocks.leaveCollaborationSession },
}));
vi.mock('../../../projectPersistence/whenProjectIdentityTransitionDependenciesConfigured', () => ({
    whenProjectIdentityTransitionDependenciesConfigured: mocks.whenProjectIdentityTransitionDependenciesConfigured,
}));

const failedCohort = {
    status: 'failed' as const,
    devices: [{ deviceId: 'levain-1', status: 'failed' as const, stage: 'content' as const }],
};

async function activateTransition(): Promise<number> {
    const transition = runProjectLoadTransaction();
    await expect(transition.prepare()).resolves.toBe(true);
    expect(transition.activate()).toBe(true);
    return projectLoadEpoch.current;
}

describe('reportDeviceReadiness', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('warns for a failed cohort whose project stays active after a replacement aborts', async () => {
        const templateEpoch = await activateTransition();

        const replacement = runProjectLoadTransaction();
        await expect(replacement.prepare()).resolves.toBe(true);
        expect(replacement.canActivate()).toBe(true);
        // The replacement withdraws without activating: the template stays open,
        // while the latest prepared transition has moved past the template.
        expect(projectLoadEpoch.current).toBe(templateEpoch);
        expect(projectLoadEpoch.isCurrent(templateEpoch)).toBe(false);

        reportDeviceReadiness(failedCohort, templateEpoch);

        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('levain-1'), 'warning');
    });

    it('suppresses a failed cohort that an activated replacement superseded', async () => {
        const templateEpoch = await activateTransition();
        const replacementEpoch = await activateTransition();

        expect(replacementEpoch).not.toBe(templateEpoch);

        reportDeviceReadiness(failedCohort, templateEpoch);

        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });
});
