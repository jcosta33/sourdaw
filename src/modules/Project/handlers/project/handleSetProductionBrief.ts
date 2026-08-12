import { createHandler } from '#/utils/createHandler';

import { isProductionBrief, type ProductionBrief } from '../../models/ProductionBrief';
import { projectStore } from '../../stores/projectStore';

function isSameIntent(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function preservesLockedIntent(current: ProductionBrief, next: ProductionBrief): boolean {
    const nextLocks = new Map(next.locks.map((lock) => [lock.id, lock]));
    for (const lock of current.locks) {
        if (!isSameIntent(lock, nextLocks.get(lock.id))) {
            return false;
        }
    }

    const nextDecisions = new Map(next.decisions.map((decision) => [decision.id, decision]));
    for (const decision of current.decisions) {
        if (decision.status === 'locked' && !isSameIntent(decision, nextDecisions.get(decision.id))) {
            return false;
        }
    }
    return true;
}

function withReplayRevision(brief: ProductionBrief, revision: number): ProductionBrief {
    return { ...structuredClone(brief), revision };
}

export const handleSetProductionBrief = createHandler<'setProductionBrief'>({
    execute: (action) => {
        const project = projectStore.value;
        const next = action.payload.brief;
        if (
            !project ||
            !isProductionBrief(next) ||
            project.productionBrief.revision !== action.payload.expectedRevision ||
            next.revision !== action.payload.expectedRevision + 1 ||
            (!action.payload.allowLockedIntentChanges && !preservesLockedIntent(project.productionBrief, next))
        ) {
            return { status: 'conflict' };
        }

        projectStore.set({ ...project, productionBrief: structuredClone(next), updatedAt: next.updatedAt });
        return { status: 'written' };
    },
    describe: (action) => {
        const current = projectStore.value?.productionBrief;
        if (!current || !isProductionBrief(action.payload.brief)) {
            return { label: 'Update production brief' };
        }
        const next = action.payload.brief;
        return {
            label: `Update production brief to revision ${next.revision}`,
            inverseAction: {
                type: 'setProductionBrief',
                payload: {
                    expectedRevision: next.revision,
                    brief: withReplayRevision(current, next.revision + 1),
                    allowLockedIntentChanges: true,
                },
            },
            redoAction: {
                type: 'setProductionBrief',
                payload: {
                    expectedRevision: next.revision + 1,
                    brief: withReplayRevision(next, next.revision + 2),
                    allowLockedIntentChanges: true,
                },
            },
        };
    },
    undoable: true,
});
