import { type ReactElement } from 'react';

import { AlertTriangle } from 'lucide-react';

import { Row, Stack } from '#/components/layout';

import { type ProjectMutationRefusal } from '../hooks/useProjectMutationRefusal';

type RepairRequiredRefusal = Extract<ProjectMutationRefusal, { kind: 'repair-required' }>;

type ProjectMutationRefusedBannerProps = {
    refusal: ProjectMutationRefusal;
};

type RefusalCopy = {
    body: string;
    heading: string;
};

function listRepairReasons(refusal: RepairRequiredRefusal): readonly string[] {
    if (!refusal.inspectionAvailable) {
        return ['the project could not be inspected'];
    }
    const reasons: string[] = [];
    if (refusal.conflictCount > 0) {
        reasons.push(`${refusal.conflictCount} unresolved conflict${refusal.conflictCount === 1 ? '' : 's'}`);
    }
    if (!refusal.invariantsValid) {
        reasons.push('invalid project structure');
    }
    if (!refusal.audioGraphValid && refusal.invariantsValid) {
        reasons.push('invalid audio routing');
    }
    if (reasons.length === 0) {
        return ['unreadable project data'];
    }
    return reasons;
}

export function describeProjectMutationRefusal(refusal: ProjectMutationRefusal): RefusalCopy {
    if (refusal.kind === 'production-brief-lock') {
        return {
            body: `"${refusal.statement}" locks the whole project, so edits are refused. Remove the lock in the production brief to continue.`,
            heading: 'This project is locked by its production brief',
        };
    }
    return {
        // The assistant is the only repair route the product has today: the agent
        // reads this same state through `getProjectContext`. Do not offer an
        // unlock or repair control here until one exists.
        body: `Sourdaw found a problem in the project's data and paused edits to protect it (${listRepairReasons(refusal).join(', ')}). Ask the assistant to repair the project.`,
        heading: "This project can't be edited or saved",
    };
}

/**
 * Persistent, non-modal explanation of why the project refuses every edit.
 *
 * Deliberately outside the shell's modal set: the launch screen, preferences,
 * the assistant panel and undo all stay reachable, because the assistant is the
 * route out of a repair-required project and the brief editor is the route out
 * of a project-wide lock.
 */
export const ProjectMutationRefusedBanner = ({ refusal }: ProjectMutationRefusedBannerProps): ReactElement => {
    const { body, heading } = describeProjectMutationRefusal(refusal);

    return (
        <Row
            align="start"
            gap={2}
            role="status"
            aria-live="polite"
            data-testid="project-mutation-refused-banner"
            className="shrink-0 border-b border-[var(--color-state-warning)]/40 bg-[var(--color-state-warning)]/10 px-3 py-2"
        >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-state-warning)]" aria-hidden="true" />
            <Stack gap={0.5}>
                <p className="text-xs font-semibold text-foreground">{heading}</p>
                <p className="text-xs text-muted-foreground">{body}</p>
            </Stack>
        </Row>
    );
};
