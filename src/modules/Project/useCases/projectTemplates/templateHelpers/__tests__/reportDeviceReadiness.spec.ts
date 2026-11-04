import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    commitProjectAuthority,
    committedProject,
} from '../../../projectPersistence/helpers/committedProjectAuthority';
import { runProjectLoadTransaction } from '../../../projectPersistence/helpers/runProjectLoadTransaction';
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

/** Open a template project: activate its transition and replace the document's authority. */
async function commitTemplateProject(): Promise<number> {
    const template = runProjectLoadTransaction();
    await expect(template.prepare()).resolves.toBe(true);
    expect(template.activate()).toBe(true);
    commitProjectAuthority();
    return committedProject.generation;
}

/** A replacement that has activated but has not reached its authority switch yet. */
async function activateReplacement(): Promise<void> {
    const replacement = runProjectLoadTransaction();
    await expect(replacement.prepare()).resolves.toBe(true);
    expect(replacement.activate()).toBe(true);
}

describe('reportDeviceReadiness', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('warns for a failed cohort after a replacement prepared and aborted', async () => {
        const committedGeneration = await commitTemplateProject();

        const replacement = runProjectLoadTransaction();
        await expect(replacement.prepare()).resolves.toBe(true);
        // The replacement never activates: the template stays the open project.
        expect(replacement.canActivate()).toBe(true);
        expect(committedProject.generation).toBe(committedGeneration);

        reportDeviceReadiness(failedCohort, committedGeneration);

        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('levain-1'), 'warning');
    });

    it('warns for a failed cohort after an activated replacement aborted before its switch', async () => {
        const committedGeneration = await commitTemplateProject();

        await activateReplacement();
        // Activation alone does not replace the document: this replacement
        // aborts before its authority switch, so the template is still open.
        expect(committedProject.generation).toBe(committedGeneration);

        reportDeviceReadiness(failedCohort, committedGeneration);

        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('levain-1'), 'warning');
    });

    it('suppresses a failed cohort once a replacement replaced the document', async () => {
        const committedGeneration = await commitTemplateProject();

        await activateReplacement();
        // This case models the switch at the report's own boundary. The wire
        // from the real reset helper to this generation is asserted by
        // `resetCrdtProjectWithTransportStopped.spec.ts`'s "tells the caller
        // once the authority is replaced and records the committed project".
        commitProjectAuthority();

        expect(committedProject.generation).not.toBe(committedGeneration);

        reportDeviceReadiness(failedCohort, committedGeneration);

        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });
});
