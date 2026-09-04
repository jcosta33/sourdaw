import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { type ProjectMutationRefusal } from '../../hooks/useProjectMutationRefusal';
import { ProjectMutationRefusedBanner } from '../ProjectMutationRefusedBanner';

const repairRefusal = (
    overrides: Omit<Extract<ProjectMutationRefusal, { kind: 'repair-required' }>, 'kind'>
): ProjectMutationRefusal => ({ kind: 'repair-required', ...overrides });

describe('ProjectMutationRefusedBanner', () => {
    it('names every unresolved conflict and the broken project structure', () => {
        render(
            <ProjectMutationRefusedBanner
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
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
});
