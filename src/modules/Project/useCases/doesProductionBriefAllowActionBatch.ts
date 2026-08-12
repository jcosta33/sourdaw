import { type AppAction } from '#/utils/handlerContract';

import { type ProductionBriefScope } from '../models/ProductionBrief';
import { projectStore } from '../stores/projectStore';

function collectActionStrings(value: unknown, values: Set<string>): void {
    if (typeof value === 'string') {
        values.add(value);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            collectActionStrings(item, values);
        }
        return;
    }
    if (!value || typeof value !== 'object') {
        return;
    }
    for (const item of Object.values(value)) {
        collectActionStrings(item, values);
    }
}

function valueOverlapsRange(value: unknown, scope: Extract<ProductionBriefScope, { kind: 'range' }>): boolean {
    if (Array.isArray(value)) {
        return value.some((item) => valueOverlapsRange(item, scope));
    }
    if (!value || typeof value !== 'object') {
        return false;
    }
    const values = value as Record<string, unknown>;
    const startBeat = values.startBeat;
    const endBeat = values.endBeat;
    if (typeof startBeat === 'number' && typeof endBeat === 'number') {
        return startBeat < scope.endBeat && endBeat > scope.startBeat;
    }
    const beat = values.beat;
    if (typeof beat === 'number' && beat >= scope.startBeat && beat < scope.endBeat) {
        return true;
    }
    return Object.values(values).some((item) => valueOverlapsRange(item, scope));
}

export function doesProductionBriefAllowActionBatch(actions: readonly AppAction[]): boolean {
    const brief = projectStore.value?.productionBrief;
    if (!brief || actions.every((action) => action.type === 'setProductionBrief')) {
        return true;
    }

    const projectActions = actions.filter((action) => action.type !== 'setProductionBrief');
    const actionStrings = new Set<string>();
    for (const action of projectActions) {
        collectActionStrings(action.payload, actionStrings);
    }

    const protectedScopes = [
        ...brief.locks.map((lock) => lock.scope),
        ...brief.decisions.filter((decision) => decision.status === 'locked').map((decision) => decision.scope),
    ];

    return protectedScopes.every((scope) => {
        if (scope.kind === 'project') {
            return false;
        }
        if (scope.kind === 'range') {
            return projectActions.every((action) => !valueOverlapsRange(action.payload, scope));
        }
        if (scope.kind === 'track') {
            return !actionStrings.has(scope.trackId);
        }
        if (scope.kind === 'section') {
            return !actionStrings.has(scope.sectionId);
        }
        if (scope.kind === 'object') {
            return !actionStrings.has(scope.objectId);
        }
        return !actionStrings.has(scope.decisionId);
    });
}
