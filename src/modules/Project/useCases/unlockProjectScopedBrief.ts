import { executeAppAction, isAppActionConflictError } from '#/modules/Command/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type ProductionBrief } from '../models/ProductionBrief';
import { authorizeProductionBriefReplay } from '../stores/productionBriefReplayAuthority';
import { projectStore } from '../stores/projectStore';

import { collectProtectedScopes } from './collectProtectedScopes';
import { isProjectWideScope } from './isProjectWideScope';

export type UnlockProjectScopedBriefOutcome = 'no-lock' | 'unlocked' | 'refused';

/**
 * Remove the production-brief entry that locks the whole project (issue #3573).
 *
 * The removal runs through the authorized replay path, exactly like an undo of
 * a brief change: `preservesLockedIntent` refuses any lock removal that is not
 * authorized, so a lock cleared any other way stays refused. Releasing a
 * decision's lock keeps the decision itself — it becomes an accepted decision
 * rather than disappearing.
 */
export async function unlockProjectScopedBrief(): Promise<UnlockProjectScopedBriefOutcome> {
    const brief = projectStore.value?.productionBrief;
    if (!brief) {
        return 'no-lock';
    }
    const protection = collectProtectedScopes(brief).find((candidate) => isProjectWideScope(candidate.scope));
    if (!protection) {
        return 'no-lock';
    }

    let locks = brief.locks;
    if (protection.source === 'lock') {
        locks = brief.locks.filter((lock) => lock.id !== protection.id);
    }
    let decisions = brief.decisions;
    if (protection.source === 'decision') {
        decisions = brief.decisions.map((decision) =>
            decision.id === protection.id ? { ...decision, status: 'accepted' as const } : decision
        );
    }
    const next: ProductionBrief = {
        ...structuredClone(brief),
        revision: brief.revision + 1,
        updatedAt: Date.now(),
        locks,
        decisions,
    };

    try {
        await executeAppAction(
            authorizeProductionBriefReplay({
                type: 'setProductionBrief',
                payload: { expectedRevision: brief.revision, brief: next },
            }),
            { source: 'manual' }
        );
    } catch (error) {
        if (isAppActionConflictError(error)) {
            notifyUser('The project lock could not be removed right now - it may have just changed', 'warning');
            return 'refused';
        }
        throw error;
    }

    notifyUser('Project-wide lock removed - edits are re-enabled', 'success');
    return 'unlocked';
}
