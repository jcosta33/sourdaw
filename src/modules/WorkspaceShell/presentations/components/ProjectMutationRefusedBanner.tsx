import { type ReactElement, useState } from 'react';

import { AlertTriangle } from 'lucide-react';

import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';

import { type ProjectMutationRefusal } from '../hooks/useProjectMutationRefusal';

type RepairRequiredRefusal = Extract<ProjectMutationRefusal, { kind: 'repair-required' }>;

type ProjectMutationRefusedBannerProps = {
    refusal: ProjectMutationRefusal;
    onRepair: () => Promise<string>;
    onUnlock: () => Promise<string>;
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
        body: `Sourdaw found a problem in the project's data and paused edits to protect it (${listRepairReasons(refusal).join(', ')}). Ask the assistant to repair the project.`,
        heading: "This project can't be edited or saved",
    };
}

/**
 * Persistent, non-modal explanation of why the project refuses every edit, with
 * the user-facing route out of the refusal (issue #3573): a Repair button while
 * the repair gate holds, a Remove-lock button while a project-wide brief lock
 * holds. Each route owns its outcome notification, so the button reports and
 * stays simple.
 *
 * Deliberately outside the shell's modal set: the launch screen, preferences,
 * the assistant panel and undo all stay reachable, because the assistant is a
 * route out of a repair-required project and the brief editor is a route out
 * of a project-wide lock. The route button is a control inside the status
 * region, not a dialog — the banner is still no part of `anyDialogOpen`.
 */
export const ProjectMutationRefusedBanner = ({
    refusal,
    onRepair,
    onUnlock,
}: ProjectMutationRefusedBannerProps): ReactElement => {
    const { body, heading } = describeProjectMutationRefusal(refusal);
    const [routePending, setRoutePending] = useState(false);

    const runRoute = (route: () => Promise<unknown>): void => {
        if (routePending) {
            return;
        }
        setRoutePending(true);
        // The route reports its own outcome notification; a rejected promise
        // here is a real failure the logger owns, not something to surface as
        // a second notification.
        void route().finally(() => {
            setRoutePending(false);
        });
    };

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
            <Stack gap={0.5} grow>
                <p className="text-xs font-semibold text-foreground">{heading}</p>
                <p className="text-xs text-muted-foreground">{body}</p>
            </Stack>
            {refusal.kind === 'repair-required' ? (
                <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    className="mt-0.5 shrink-0 self-start"
                    disabled={routePending}
                    onClick={() => runRoute(onRepair)}
                >
                    Repair project
                </Button>
            ) : null}
            {refusal.kind === 'production-brief-lock' ? (
                <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    className="mt-0.5 shrink-0 self-start"
                    disabled={routePending}
                    onClick={() => runRoute(onUnlock)}
                >
                    Remove lock
                </Button>
            ) : null}
        </Row>
    );
};
