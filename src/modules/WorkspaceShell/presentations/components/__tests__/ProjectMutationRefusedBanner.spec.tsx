import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { type ProjectMutationRefusal } from '../../hooks/useProjectMutationRefusal';
import { ProjectMutationRefusedBanner } from '../ProjectMutationRefusedBanner';

const mocks = vi.hoisted(() => ({
    repairProjectData: vi.fn(),
    unlockProjectScopedBrief: vi.fn(),
}));

vi.mock('#/modules/Project/useCases', () => ({
    getProjectScopedBriefLock: vi.fn(),
    repairProjectData: mocks.repairProjectData,
    unlockProjectScopedBrief: mocks.unlockProjectScopedBrief,
}));

const repairRefusal = (
    overrides: Omit<Extract<ProjectMutationRefusal, { kind: 'repair-required' }>, 'kind'>
): ProjectMutationRefusal => ({ kind: 'repair-required', ...overrides });

describe('ProjectMutationRefusedBanner', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('names every unresolved conflict and the broken project structure', () => {
        render(
            <ProjectMutationRefusedBanner
                onRepair={mocks.repairProjectData}
                onUnlock={mocks.unlockProjectScopedBrief}
                refusal={repairRefusal({
                    audioGraphValid: false,
                    conflictCount: 3,
                    inspectionAvailable: true,
                    invariantsValid: false,
                })}
            />
        );

        expect(screen.getByText("This project can't be edited or saved")).toBeInTheDocument();
        expect(
            screen.getByText(
                "Sourdaw found a problem in the project's data and paused edits to protect it (3 unresolved conflicts, invalid project structure). Ask the assistant to repair the project."
            )
        ).toBeInTheDocument();
    });

    it('names a single conflict in the singular', () => {
        render(
            <ProjectMutationRefusedBanner
                onRepair={mocks.repairProjectData}
                onUnlock={mocks.unlockProjectScopedBrief}
                refusal={repairRefusal({
                    audioGraphValid: true,
                    conflictCount: 1,
                    inspectionAvailable: true,
                    invariantsValid: true,
                })}
            />
        );

        expect(
            screen.getByText(
                "Sourdaw found a problem in the project's data and paused edits to protect it (1 unresolved conflict). Ask the assistant to repair the project."
            )
        ).toBeInTheDocument();
    });

    it('names invalid audio routing when the project structure is intact', () => {
        render(
            <ProjectMutationRefusedBanner
                onRepair={mocks.repairProjectData}
                onUnlock={mocks.unlockProjectScopedBrief}
                refusal={repairRefusal({
                    audioGraphValid: false,
                    conflictCount: 0,
                    inspectionAvailable: true,
                    invariantsValid: true,
                })}
            />
        );

        expect(
            screen.getByText(
                "Sourdaw found a problem in the project's data and paused edits to protect it (invalid audio routing). Ask the assistant to repair the project."
            )
        ).toBeInTheDocument();
    });

    it('falls back to unreadable project data when nothing else is known', () => {
        render(
            <ProjectMutationRefusedBanner
                onRepair={mocks.repairProjectData}
                onUnlock={mocks.unlockProjectScopedBrief}
                refusal={repairRefusal({
                    audioGraphValid: true,
                    conflictCount: 0,
                    inspectionAvailable: true,
                    invariantsValid: true,
                })}
            />
        );

        expect(
            screen.getByText(
                "Sourdaw found a problem in the project's data and paused edits to protect it (unreadable project data). Ask the assistant to repair the project."
            )
        ).toBeInTheDocument();
    });

    it('reports an unrun inspection honestly instead of claiming the project structure is invalid', () => {
        render(
            <ProjectMutationRefusedBanner
                onRepair={mocks.repairProjectData}
                onUnlock={mocks.unlockProjectScopedBrief}
                refusal={repairRefusal({
                    audioGraphValid: false,
                    conflictCount: 0,
                    inspectionAvailable: false,
                    invariantsValid: false,
                })}
            />
        );

        expect(
            screen.getByText(
                "Sourdaw found a problem in the project's data and paused edits to protect it (the project could not be inspected). Ask the assistant to repair the project."
            )
        ).toBeInTheDocument();
        expect(screen.queryByText(/invalid project structure/)).not.toBeInTheDocument();
    });

    it('quotes the locking statement from the production brief', () => {
        render(
            <ProjectMutationRefusedBanner
                onRepair={mocks.repairProjectData}
                onUnlock={mocks.unlockProjectScopedBrief}
                refusal={{ kind: 'production-brief-lock', statement: 'Freeze the whole arrangement' }}
            />
        );

        expect(screen.getByText('This project is locked by its production brief')).toBeInTheDocument();
        expect(
            screen.getByText(
                '"Freeze the whole arrangement" locks the whole project, so edits are refused. Remove the lock in the production brief to continue.'
            )
        ).toBeInTheDocument();
    });

    it('announces itself politely and offers no control that would dismiss it', () => {
        render(
            <ProjectMutationRefusedBanner
                onRepair={mocks.repairProjectData}
                onUnlock={mocks.unlockProjectScopedBrief}
                refusal={repairRefusal({
                    audioGraphValid: true,
                    conflictCount: 1,
                    inspectionAvailable: true,
                    invariantsValid: true,
                })}
            />
        );

        const banner = screen.getByTestId('project-mutation-refused-banner');
        expect(banner).toHaveAttribute('role', 'status');
        expect(banner).toHaveAttribute('aria-live', 'polite');
        expect(screen.getByRole('status')).toBe(banner);
        // The route out of the refusal is the repair, never a dismissal: the
        // only button is the repair route, which clears the state it names.
        expect(screen.getByRole('button', { name: 'Repair project' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /dismiss|close/i })).not.toBeInTheDocument();
    });

    it('offers the repair route only while the repair gate holds', () => {
        render(
            <ProjectMutationRefusedBanner
                onRepair={mocks.repairProjectData}
                onUnlock={mocks.unlockProjectScopedBrief}
                refusal={{ kind: 'production-brief-lock', statement: 'Freeze the whole arrangement' }}
            />
        );

        expect(screen.queryByRole('button', { name: 'Repair project' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Remove lock' })).toBeInTheDocument();
    });

    it('dispatches the project-data repair from the repair button', () => {
        mocks.repairProjectData.mockResolvedValue('repaired');
        render(
            <ProjectMutationRefusedBanner
                onRepair={mocks.repairProjectData}
                onUnlock={mocks.unlockProjectScopedBrief}
                refusal={repairRefusal({
                    audioGraphValid: true,
                    conflictCount: 1,
                    inspectionAvailable: true,
                    invariantsValid: true,
                })}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Repair project' }));

        expect(mocks.repairProjectData).toHaveBeenCalledOnce();
        expect(mocks.unlockProjectScopedBrief).not.toHaveBeenCalled();
    });

    it('dispatches the authorized unlock from the remove-lock button', () => {
        mocks.unlockProjectScopedBrief.mockResolvedValue('unlocked');
        render(
            <ProjectMutationRefusedBanner
                onRepair={mocks.repairProjectData}
                onUnlock={mocks.unlockProjectScopedBrief}
                refusal={{ kind: 'production-brief-lock', statement: 'Freeze the whole arrangement' }}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Remove lock' }));

        expect(mocks.unlockProjectScopedBrief).toHaveBeenCalledOnce();
        expect(mocks.repairProjectData).not.toHaveBeenCalled();
    });
});
