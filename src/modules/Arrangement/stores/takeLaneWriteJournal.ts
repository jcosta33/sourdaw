import {
    AutomergeStorageWriteConflictError,
    getCurrentAutomergeStorageMutationOwner,
} from '#/infra/store/storage/createAutomergeStorage';

import { type CompRegion, type Take, type TakeLane } from '../models/TakeLane';

import { applyTakeFieldOperation } from './applyTakeFieldOperation';
import {
    captureBaseGapAudioSources,
    replaceBaseGapAudioSources,
    reconcileBaseGapAudioSourceDelta,
} from './baseGapAudioSourceDelta';
import { captureDelta } from './captureTakeLaneDelta';
import { type CompAudioSourceInputContext } from './compAudioSourceInputs';
import {
    applyCompAudioSourcePromotions,
    compSelectionMatchesSources,
    type CompAudioSourceAuthorization,
} from './compAudioSourcePromotions';
import { cloneValue, optionalString, valuesEqual } from './takeLaneJournalValues';
import {
    type LaneWriteOperation,
    type TakeLaneWriteIntent,
    type TakeLaneStoreValue,
    type TakeLaneCompRegionPatch,
    type TakeLaneWriteOperation,
    type TakeLaneWriteJournal,
} from './takeLaneWriteJournalTypes';
import { projectTempoAudioSourceLanes } from './tempoAudioSources';
import { tempoAudioSourceWriteIntentMatches } from './tempoAudioSourceWriteIntent';

export {
    captureBaseGapAudioSources,
    replaceBaseGapAudioSources,
    type OptionalAudioSourceTiles,
} from './baseGapAudioSourceDelta';

export type {
    TakeLaneStoreValue,
    TakeLaneCompRegionPatch,
    TakeLaneWriteOperation,
    TakeLaneWriteJournal,
} from './takeLaneWriteJournalTypes';

let pendingWriteIntent: { readonly intent: TakeLaneWriteIntent; readonly owner: object | undefined } | undefined;

export function runWithTakeLaneWriteIntent<Result>(intent: TakeLaneWriteIntent, callback: () => Result): Result {
    const previousIntent = pendingWriteIntent;
    pendingWriteIntent = { intent: cloneValue(intent), owner: getCurrentAutomergeStorageMutationOwner() };
    try {
        return callback();
    } finally {
        pendingWriteIntent = previousIntent;
    }
}

export function captureTakeLaneWriteJournal(input: {
    readonly beforeValue: TakeLaneStoreValue | null;
    readonly nextValue: TakeLaneStoreValue | null;
}): TakeLaneWriteJournal {
    const pending = pendingWriteIntent;
    pendingWriteIntent = undefined;
    if (pending && pending.owner !== getCurrentAutomergeStorageMutationOwner()) {
        throw new AutomergeStorageWriteConflictError('Comp source intent belongs to another mutation owner');
    }
    const intent = pending?.intent;
    if (intent?.kind === 'tempo-audio-sources') {
        return [cloneValue(intent)];
    }
    if (intent?.kind === 'comp-region-interval') {
        const operation: Extract<TakeLaneWriteOperation, { kind: 'comp-region-interval' }> = {
            kind: 'comp-region-interval',
            patch: cloneValue(intent.patch),
        };
        if (intent.sourceAuthorizations !== undefined) {
            return [{ ...operation, sourceAuthorizations: cloneValue(intent.sourceAuthorizations) }];
        }
        return [operation];
    }
    if (intent?.kind === 'replace-state') {
        return [
            {
                kind: 'replace-state',
                expected: cloneValue(input.beforeValue),
                replacement: cloneValue(input.nextValue),
            },
        ];
    }
    return captureDelta(input.beforeValue, input.nextValue);
}

export function appendTakeLaneWriteJournal(
    current: TakeLaneWriteJournal | null,
    captured: TakeLaneWriteJournal
): TakeLaneWriteJournal {
    const journal = current ? [...current] : [];
    return journal.concat(captured.map(cloneValue));
}

export function captureCompSelection(regions: readonly CompRegion[], startBeat: number, endBeat: number): CompRegion[] {
    const clipped = regions.map((region) => ({
        ...cloneValue(region),
        startBeat: Math.max(region.startBeat, startBeat),
        endBeat: Math.min(region.endBeat, endBeat),
        takeId: region.takeId,
    }));
    const overlapping = clipped.filter((region) => region.startBeat < region.endBeat);
    const ordered = overlapping.toSorted((left, right) => left.startBeat - right.startBeat);
    return coalesceSelection(ordered, () => true);
}

function coalesceSelection(regions: readonly CompRegion[], canJoinAt: (beat: number) => boolean): CompRegion[] {
    const result: CompRegion[] = [];
    for (const region of regions) {
        const previous = result[result.length - 1];
        if (
            previous &&
            previous.takeId === region.takeId &&
            valuesEqual(previous.audioSource, region.audioSource) &&
            previous.endBeat === region.startBeat &&
            canJoinAt(region.startBeat)
        ) {
            result[result.length - 1] = { ...previous, endBeat: region.endBeat };
        } else {
            result.push(region);
        }
    }
    return result;
}

function applyCompRegionPatch(
    state: TakeLaneStoreValue,
    patch: TakeLaneCompRegionPatch,
    context?: CompAudioSourceInputContext,
    authorizations: readonly CompAudioSourceAuthorization[] = []
): TakeLaneStoreValue | null {
    const matchingLanes = state.lanes.filter((lane) => lane.trackId === patch.trackId);
    const lane = matchingLanes.length === 1 && matchingLanes[0]?.id === patch.laneId ? matchingLanes[0] : undefined;
    if (!lane) {
        return null;
    }
    const takeIds = new Set(lane.takes.map((take) => take.id));
    if (
        ![...patch.expected, ...patch.replacement].every((span) => takeIds.has(span.takeId)) ||
        !compSelectionMatchesSources(
            lane,
            captureCompSelection(lane.activeCompRegions, patch.startBeat, patch.endBeat),
            patch,
            context
        )
    ) {
        return null;
    }
    const retained = lane.activeCompRegions.flatMap((region) => {
        if (region.endBeat <= patch.startBeat || region.startBeat >= patch.endBeat) {
            return [region];
        }
        const fragments: CompRegion[] = [];
        if (region.startBeat < patch.startBeat) {
            fragments.push({ ...region, endBeat: patch.startBeat });
        }
        if (region.endBeat > patch.endBeat) {
            fragments.push({ ...region, startBeat: patch.endBeat });
        }
        return fragments;
    });
    const regions = [...retained, ...patch.replacement.map(cloneValue)].sort((a, b) => a.startBeat - b.startBeat);
    const promoted = applyCompAudioSourcePromotions(lane, regions, patch, context, authorizations);
    if (!promoted) {
        return null;
    }
    const next = {
        ...promoted,
        activeCompRegions: coalesceSelection(
            promoted.activeCompRegions,
            (beat) => beat >= patch.startBeat && beat <= patch.endBeat
        ),
    };
    const lanes = state.lanes.map((candidate) => (candidate.id === lane.id ? next : candidate));
    return { lanes };
}

function findLane(state: TakeLaneStoreValue, laneId: string): TakeLane | undefined {
    return state.lanes.find((lane) => lane.id === laneId);
}

function findTake(lane: TakeLane, takeId: string): Take | undefined {
    return lane.takes.find((take) => take.id === takeId);
}

function insertAfter<Item extends { readonly id: string }>(
    items: readonly Item[],
    item: Item,
    afterId: string | null
): Item[] {
    const result = [...items];
    const afterIndex = afterId === null ? -1 : result.findIndex((candidate) => candidate.id === afterId);
    result.splice(afterIndex < 0 ? 0 : afterIndex + 1, 0, cloneValue(item));
    return result;
}

function replaceLane(state: TakeLaneStoreValue, replacement: TakeLane): TakeLaneStoreValue {
    return { lanes: state.lanes.map((lane) => (lane.id === replacement.id ? replacement : lane)) };
}

function applyLaneOperation(
    state: TakeLaneStoreValue,
    lane: TakeLane,
    operation: LaneWriteOperation
): TakeLaneStoreValue | undefined {
    if (operation.kind === 'lane-track-field') {
        if (lane.trackId !== operation.expected) {
            return undefined;
        }
        return replaceLane(state, { ...lane, trackId: operation.replacement });
    }
    if (operation.kind === 'lane-automation-field') {
        if (!valuesEqual(optionalString(lane, 'automationLaneId'), operation.expected)) {
            return undefined;
        }
        const replacement = cloneValue(lane);
        if (operation.replacement.present) {
            replacement.automationLaneId = operation.replacement.value;
        } else {
            delete replacement.automationLaneId;
        }
        return replaceLane(state, replacement);
    }
    if (operation.kind === 'insert-take') {
        if (findTake(lane, operation.take.id)) {
            return undefined;
        }
        return replaceLane(state, {
            ...lane,
            takes: insertAfter(lane.takes, operation.take, operation.afterTakeId),
        });
    }
    if (operation.kind === 'remove-take') {
        if (!findTake(lane, operation.takeId)) {
            return undefined;
        }
        return replaceLane(state, { ...lane, takes: lane.takes.filter((take) => take.id !== operation.takeId) });
    }
    if (operation.kind === 'replace-base-gap-audio-sources') {
        const sources = reconcileBaseGapAudioSourceDelta(
            captureBaseGapAudioSources(lane),
            operation.expected,
            operation.replacement
        );
        return sources ? replaceLane(state, replaceBaseGapAudioSources(lane, sources)) : undefined;
    }
    if (operation.kind === 'replace-comp-regions') {
        if (!valuesEqual(lane.activeCompRegions, operation.expected)) {
            return undefined;
        }
        return replaceLane(state, { ...lane, activeCompRegions: operation.replacement.map(cloneValue) });
    }
    return applyTakeFieldOperation(state, lane, operation);
}

function applyOperation(
    current: TakeLaneStoreValue | null,
    operation: TakeLaneWriteOperation,
    context?: CompAudioSourceInputContext
): TakeLaneStoreValue | null | undefined {
    if (operation.kind === 'replace-state') {
        return valuesEqual(current, operation.expected) ? cloneValue(operation.replacement) : undefined;
    }
    if (current === null) {
        return undefined;
    }
    if (operation.kind === 'tempo-audio-sources') {
        if (!context || !tempoAudioSourceWriteIntentMatches(operation.intent, { ...context, takeLanes: current })) {
            return undefined;
        }
        const lanes = projectTempoAudioSourceLanes(
            current.lanes,
            operation.intent.promotion,
            operation.intent.direction
        );
        return lanes ? { lanes } : undefined;
    }
    if (operation.kind === 'comp-region-interval') {
        return applyCompRegionPatch(current, operation.patch, context, operation.sourceAuthorizations) ?? undefined;
    }
    if (operation.kind === 'insert-lane') {
        if (findLane(current, operation.lane.id)) {
            return undefined;
        }
        return { lanes: insertAfter(current.lanes, operation.lane, operation.afterLaneId) };
    }
    if (operation.kind === 'remove-lane') {
        if (!findLane(current, operation.laneId)) {
            return undefined;
        }
        return { lanes: current.lanes.filter((lane) => lane.id !== operation.laneId) };
    }
    const lane = findLane(current, operation.laneId);
    if (!lane) {
        return undefined;
    }
    return applyLaneOperation(current, lane, operation);
}

export function replayTakeLaneWriteJournal(
    authority: TakeLaneStoreValue | null,
    journal: TakeLaneWriteJournal,
    context?: CompAudioSourceInputContext
): { readonly status: 'applied'; readonly value: TakeLaneStoreValue | null } | { readonly status: 'conflict' } {
    let value = cloneValue(authority);
    for (const operation of journal) {
        const next = applyOperation(value, operation, context);
        if (next === undefined) {
            return { status: 'conflict' };
        }
        value = next;
    }
    return { status: 'applied', value };
}

export function applyTakeLaneCompRegionPatch(
    state: TakeLaneStoreValue,
    patch: TakeLaneCompRegionPatch,
    context?: CompAudioSourceInputContext,
    authorizations: readonly CompAudioSourceAuthorization[] = []
): TakeLaneStoreValue | null {
    return applyCompRegionPatch(state, patch, context, authorizations);
}

export function takeLaneValuesEqual(left: unknown, right: unknown): boolean {
    return valuesEqual(left, right);
}
