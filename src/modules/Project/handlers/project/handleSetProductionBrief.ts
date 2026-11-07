import { markerStore, trackStore } from '#/modules/Arrangement/stores';
import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';
import { jsonValuesEqual } from '#/utils/jsonSemanticEquality';

import { isProductionBrief, type ProductionBrief, type ProductionBriefScope } from '../../models/ProductionBrief';
import {
    authorizeProductionBriefReplay,
    isAuthorizedProductionBriefReplay,
} from '../../stores/productionBriefReplayAuthority';
import { projectStore } from '../../stores/projectStore';

import { isProductionBriefSessionEntry, restoreProductionBriefSessionEntry } from './productionBriefSessionEntry';

function isSameIntent(left: unknown, right: unknown): boolean {
    return jsonValuesEqual(left, right);
}

function preservesDecisionHistory(
    current: ProductionBrief,
    next: ProductionBrief,
    lockedDecisionIds: ReadonlySet<string>
): boolean {
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
        if (lockedDecisionIds.has(decision.id)) {
            return false;
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
    const lockedDecisionIds = new Set(
        current.locks.flatMap((lock) => (lock.scope.kind === 'decision' ? [lock.scope.decisionId] : []))
    );
    for (const lock of current.locks) {
        if (!isSameIntent(lock, nextLocks.get(lock.id))) {
            return false;
        }
    }

    return preservesDecisionHistory(current, next, lockedDecisionIds);
}

function withReplayRevision(brief: ProductionBrief, revision: number): ProductionBrief {
    return { ...structuredClone(brief), revision };
}

type BriefTarget = { kind: 'track' | 'section'; id: string };

function readScopeTargets(scope: ProductionBriefScope): BriefTarget[] {
    if (scope.kind === 'track') {
        return [{ kind: 'track', id: scope.trackId }];
    }
    if (scope.kind === 'section') {
        return [{ kind: 'section', id: scope.sectionId }];
    }
    return [];
}

/** The entries this write adds or changes; one it carries over unchanged was checked when it was written. */
function readWrittenEntries<Entry extends { id: string }>(current: readonly Entry[], next: readonly Entry[]): Entry[] {
    const held = new Map(current.map((entry) => [entry.id, entry]));
    return next.filter((entry) => !isSameIntent(entry, held.get(entry.id)));
}

function readWrittenTargets(current: ProductionBrief, next: ProductionBrief): BriefTarget[] {
    const scoped = [
        ...readWrittenEntries(current.hardConstraints, next.hardConstraints),
        ...readWrittenEntries(current.preferences, next.preferences),
        ...readWrittenEntries(current.locks, next.locks),
        ...readWrittenEntries(current.decisions, next.decisions),
    ];
    return [
        ...scoped.flatMap((entry) => readScopeTargets(entry.scope)),
        ...readWrittenEntries(current.sectionGoals, next.sectionGoals).map((goal): BriefTarget => ({
            kind: 'section',
            id: goal.sectionId,
        })),
        ...readWrittenEntries(current.trackRoles, next.trackRoles).map((role): BriefTarget => ({
            kind: 'track',
            id: role.trackId,
        })),
    ];
}

function isHeldByProject(target: BriefTarget): boolean {
    if (target.kind === 'track') {
        return trackStore.value?.tracks.some((track) => track.id === target.id) ?? false;
    }
    return markerStore.value?.sections.some((section) => section.id === target.id) ?? false;
}

/**
 * The first track or section this write names anew that the project no longer holds. A pending card
 * outlives edits to the objects it names, so the write is checked against the project as it is when it
 * runs. An undo or redo replay restores a brief that was valid when written and is left to `execute`.
 */
function findMissingTarget(action: Extract<AppAction, { type: 'setProductionBrief' }>): BriefTarget | null {
    const current = projectStore.value?.productionBrief;
    const next = action.payload.brief;
    if (current === undefined || !isProductionBrief(next) || isAuthorizedProductionBriefReplay(action)) {
        return null;
    }
    return readWrittenTargets(current, next).find((target) => !isHeldByProject(target)) ?? null;
}

export const handleSetProductionBrief = createHandler<'setProductionBrief'>({
    validate: (action) => findMissingTarget(action) === null,
    validationRefusalReason: (action) => {
        const missing = findMissingTarget(action);
        if (missing === null) {
            return null;
        }
        return `The production brief names a ${missing.kind} the project no longer holds (${missing.id}).`;
    },
    // Every write, and so every inverse, names the revision it replaces and `execute` refuses any
    // other, so reapplying it in a confirmed batch after the project moved can never overwrite a
    // brief someone else wrote meanwhile: it lands on the revision it was composed against or not at all.
    canReapplyAfterDivergence: (action) => Number.isInteger(action.payload.expectedRevision),
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
    validateSessionEntry: isProductionBriefSessionEntry,
    restoreSessionEntry: restoreProductionBriefSessionEntry,
    batchExecution: 'singleton',
    undoable: true,
});
