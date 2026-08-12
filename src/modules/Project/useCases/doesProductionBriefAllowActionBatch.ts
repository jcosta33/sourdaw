import { markerStore, trackStore } from '#/modules/Arrangement/stores';
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
    for (const [key, item] of Object.entries(values)) {
        if (key.endsWith('Beat') && typeof item === 'number' && item >= scope.startBeat && item < scope.endBeat) {
            return true;
        }
    }
    return Object.values(values).some((item) => valueOverlapsRange(item, scope));
}

function findClip(clipId: string) {
    for (const track of trackStore.value?.tracks ?? []) {
        const clip = [...track.clips, ...track.alternatives.flatMap((alternative) => alternative.clips)].find(
            (candidate) => candidate.id === clipId
        );
        if (clip) {
            return clip;
        }
    }
    return undefined;
}

function intervalOverlapsRange(
    startBeat: number,
    endBeat: number,
    scope: Extract<ProductionBriefScope, { kind: 'range' }>
): boolean {
    return endBeat > startBeat && startBeat < scope.endBeat && endBeat > scope.startBeat;
}

function projectedClipOverlapsRange(
    action: AppAction,
    scope: Extract<ProductionBriefScope, { kind: 'range' }>
): boolean {
    if (action.type === 'moveClip') {
        const clip = findClip(action.payload.clipId);
        if (!clip) {
            return false;
        }
        const endBeat = action.payload.startBeat + (clip.endBeat - clip.startBeat);
        return intervalOverlapsRange(action.payload.startBeat, endBeat, scope);
    }
    if (action.type === 'trimClipStart') {
        const clip = findClip(action.payload.clipId);
        return clip ? intervalOverlapsRange(action.payload.newStartBeat, clip.endBeat, scope) : false;
    }
    if (action.type === 'trimClipEnd') {
        const clip = findClip(action.payload.clipId);
        return clip ? intervalOverlapsRange(clip.startBeat, action.payload.newEndBeat, scope) : false;
    }
    return false;
}

function actionOverlapsRange(action: AppAction, scope: Extract<ProductionBriefScope, { kind: 'range' }>): boolean {
    return (
        valueOverlapsRange(action.payload, scope) ||
        referencedClipOverlapsRange(action, scope) ||
        projectedClipOverlapsRange(action, scope)
    );
}

function trackOwnedIds(trackId: string): Set<string> {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    if (!track) {
        return new Set([trackId]);
    }
    return new Set([
        track.id,
        ...track.clips.map((clip) => clip.id),
        ...track.alternatives.map((alternative) => alternative.id),
        ...track.alternatives.flatMap((alternative) => alternative.clips.map((clip) => clip.id)),
        ...track.devices.map((device) => device.id),
        ...track.midiFx.map((device) => device.id),
    ]);
}

function referencedClipOverlapsRange(
    action: AppAction,
    scope: Extract<ProductionBriefScope, { kind: 'range' }>
): boolean {
    const identifiers = new Set<string>();
    collectActionStrings(action.payload, identifiers);
    return (
        trackStore.value?.tracks.some((track) =>
            [...track.clips, ...track.alternatives.flatMap((alternative) => alternative.clips)].some(
                (clip) => identifiers.has(clip.id) && clip.startBeat < scope.endBeat && clip.endBeat > scope.startBeat
            )
        ) ?? false
    );
}

export function doesProductionBriefAllowActionBatch(actions: readonly AppAction[]): boolean {
    const brief = projectStore.value?.productionBrief;
    if (!brief || actions.every((action) => action.type === 'setProductionBrief')) {
        return true;
    }

    if (actions.some((action) => action.type === 'setProductionBrief')) {
        return false;
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
            return projectActions.every((action) => !actionOverlapsRange(action, scope));
        }
        if (scope.kind === 'track') {
            const ownedIds = trackOwnedIds(scope.trackId);
            return [...ownedIds].every((id) => !actionStrings.has(id));
        }
        if (scope.kind === 'section') {
            if (actionStrings.has(scope.sectionId)) {
                return false;
            }
            const section = markerStore.value?.sections.find((candidate) => candidate.id === scope.sectionId);
            if (!section) {
                return true;
            }
            const sectionRange = { kind: 'range' as const, startBeat: section.startBeat, endBeat: section.endBeat };
            return projectActions.every((action) => !actionOverlapsRange(action, sectionRange));
        }
        if (scope.kind === 'object') {
            return !actionStrings.has(scope.objectId);
        }
        return !actionStrings.has(scope.decisionId);
    });
}
