import { projectStore } from '../stores/projectStore';

import { collectProtectedScopes } from './collectProtectedScopes';
import { isProjectWideScope } from './isProjectWideScope';

export type ProjectScopedBriefLock = {
    id: string;
    kind: 'lock' | 'decision';
    statement: string;
};

/**
 * The brief entry that currently locks the whole project, or `null`.
 *
 * Reads the same protected-scope collection the batch admission guard reads, so
 * a caller explaining a refusal cannot report a lock the guard does not enforce.
 */
export function getProjectScopedBriefLock(): ProjectScopedBriefLock | null {
    const brief = projectStore.value?.productionBrief;
    if (!brief) {
        return null;
    }
    const protection = collectProtectedScopes(brief).find((candidate) => isProjectWideScope(candidate.scope));
    if (!protection) {
        return null;
    }
    return { id: protection.id, kind: protection.source, statement: protection.statement };
}
