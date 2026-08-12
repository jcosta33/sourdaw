import { createHandler } from '#/utils/createHandler';

import { isProductionBrief, type ProductionBrief } from '../../models/ProductionBrief';
import {
    authorizeProductionBriefReplay,
    isAuthorizedProductionBriefReplay,
} from '../../stores/productionBriefReplayAuthority';
import { projectStore } from '../../stores/projectStore';

function isSameIntent(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function preservesDecisionHistory(current: ProductionBrief, next: ProductionBrief): boolean {
    const currentDecisionIds = new Set(current.decisions.map((decision) => decision.id));
    const nextDecisions = new Map(next.decisions.map((decision) => [decision.id, decision]));
    for (const decision of current.decisions) {
        const nextDecision = nextDecisions.get(decision.id);
        if (!nextDecision) {
            return false;
        }
        if (isSameIntent(decision, nextDecision)) {
            continue;
        }
        const supersedingDecisionId = nextDecision.supersededByDecisionId;
        const preservedAsSuperseded =
            decision.status !== 'locked' &&
            decision.status !== 'superseded' &&
            nextDecision.status === 'superseded' &&
            typeof supersedingDecisionId === 'string' &&
            supersedingDecisionId.length > 0 &&
            !currentDecisionIds.has(supersedingDecisionId) &&
            nextDecisions.has(supersedingDecisionId) &&
            isSameIntent(
                { ...decision, status: 'superseded', supersededByDecisionId: supersedingDecisionId },
                nextDecision
            );
        if (!preservedAsSuperseded) {
            return false;
        }
    }
    return true;
}

function preservesLockedIntent(current: ProductionBrief, next: ProductionBrief): boolean {
    const nextLocks = new Map(next.locks.map((lock) => [lock.id, lock]));
    for (const lock of current.locks) {
        if (!isSameIntent(lock, nextLocks.get(lock.id))) {
            return false;
        }
    }

    return preservesDecisionHistory(current, next);
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
            (!isAuthorizedProductionBriefReplay(action) && !preservesLockedIntent(project.productionBrief, next))
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
        const addedDecisions = next.decisions.filter(
            (decision) => !current.decisions.some((candidate) => candidate.id === decision.id)
        );
        let label = `Update production brief to revision ${next.revision}`;
        const addedDecision = addedDecisions[0];
        if (addedDecisions.length === 1 && addedDecision) {
            label = `Accept creative intent: ${addedDecision.statement}`;
        }
        return {
            label,
            inverseAction: authorizeProductionBriefReplay({
                type: 'setProductionBrief',
                payload: {
                    expectedRevision: next.revision,
                    brief: withReplayRevision(current, next.revision + 1),
                },
            }),
            redoAction: authorizeProductionBriefReplay({
                type: 'setProductionBrief',
                payload: {
                    expectedRevision: next.revision + 1,
                    brief: withReplayRevision(next, next.revision + 2),
                },
            }),
        };
    },
    batchExecution: 'singleton',
    undoable: true,
});
