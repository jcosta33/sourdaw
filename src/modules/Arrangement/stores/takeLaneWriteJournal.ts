import { type CompRegion, type Take, type TakeLane } from '../models/TakeLane';

export type TakeLaneStoreValue = {
    lanes: TakeLane[];
};

export type TakeLaneCompRegionPatch = {
    readonly laneId: string;
    readonly trackId: string;
    readonly startBeat: number;
    readonly endBeat: number;
    readonly expected: readonly CompRegion[];
    readonly replacement: readonly CompRegion[];
};

type OptionalStringValue = { readonly present: false } | { readonly present: true; readonly value: string };

type OptionalNumberValue = { readonly present: false } | { readonly present: true; readonly value: number };

type TakeFieldOperation =
    | {
          readonly kind: 'take-string-field';
          readonly laneId: string;
          readonly takeId: string;
          readonly field: 'clipId' | 'name';
          readonly expected: string;
          readonly replacement: string;
      }
    | {
          readonly kind: 'take-number-field';
          readonly laneId: string;
          readonly takeId: string;
          readonly field: 'startBeat' | 'endBeat';
          readonly expected: number;
          readonly replacement: number;
      }
    | {
          readonly kind: 'take-selected-field';
          readonly laneId: string;
          readonly takeId: string;
          readonly expected: boolean;
          readonly replacement: boolean;
      }
    | {
          readonly kind: 'take-source-offset-field';
          readonly laneId: string;
          readonly takeId: string;
          readonly expected: OptionalNumberValue;
          readonly replacement: OptionalNumberValue;
      };

export type TakeLaneWriteOperation =
    | {
          readonly kind: 'replace-state';
          readonly expected: TakeLaneStoreValue | null;
          readonly replacement: TakeLaneStoreValue | null;
      }
    | { readonly kind: 'comp-region-interval'; readonly patch: TakeLaneCompRegionPatch }
    | { readonly kind: 'insert-lane'; readonly lane: TakeLane; readonly afterLaneId: string | null }
    | { readonly kind: 'remove-lane'; readonly laneId: string }
    | {
          readonly kind: 'lane-track-field';
          readonly laneId: string;
          readonly expected: string;
          readonly replacement: string;
      }
    | {
          readonly kind: 'lane-automation-field';
          readonly laneId: string;
          readonly expected: OptionalStringValue;
          readonly replacement: OptionalStringValue;
      }
    | {
          readonly kind: 'insert-take';
          readonly laneId: string;
          readonly take: Take;
          readonly afterTakeId: string | null;
      }
    | { readonly kind: 'remove-take'; readonly laneId: string; readonly takeId: string }
    | TakeFieldOperation
    | {
          readonly kind: 'replace-comp-regions';
          readonly laneId: string;
          readonly expected: readonly CompRegion[];
          readonly replacement: readonly CompRegion[];
      };

export type TakeLaneWriteJournal = readonly TakeLaneWriteOperation[];

type TakeLaneWriteIntent =
    | { readonly kind: 'comp-region-interval'; readonly patch: TakeLaneCompRegionPatch }
    | { readonly kind: 'replace-state' };

let pendingWriteIntent: TakeLaneWriteIntent | undefined;

function cloneValue<T>(value: T): T {
    return structuredClone(value);
}

function valuesEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) {
        return true;
    }
    if (Array.isArray(left) || Array.isArray(right)) {
        return (
            Array.isArray(left) &&
            Array.isArray(right) &&
            left.length === right.length &&
            left.every((value, index) => valuesEqual(value, right[index]))
        );
    }
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
        return false;
    }
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    return (
        leftKeys.length === rightKeys.length &&
        leftKeys.every((key, index) => key === rightKeys[index] && valuesEqual(leftRecord[key], rightRecord[key]))
    );
}

function optionalString(source: TakeLane, field: 'automationLaneId'): OptionalStringValue {
    if (Object.hasOwn(source, field) && source[field] !== undefined) {
        return { present: true, value: source[field] };
    }
    return { present: false };
}

function optionalNumber(source: Take, field: 'sourceOffsetBeats'): OptionalNumberValue {
    if (Object.hasOwn(source, field) && source[field] !== undefined) {
        return { present: true, value: source[field] };
    }
    return { present: false };
}

function previousIdentity<T extends { readonly id: string }>(items: readonly T[], index: number): string | null {
    return index > 0 ? (items[index - 1]?.id ?? null) : null;
}

function captureTakeFieldOperations(laneId: string, before: Take, next: Take): TakeFieldOperation[] {
    const operations: TakeFieldOperation[] = [];
    for (const field of ['clipId', 'name'] as const) {
        if (before[field] !== next[field]) {
            operations.push({
                kind: 'take-string-field',
                laneId,
                takeId: before.id,
                field,
                expected: before[field],
                replacement: next[field],
            });
        }
    }
    for (const field of ['startBeat', 'endBeat'] as const) {
        if (before[field] !== next[field]) {
            operations.push({
                kind: 'take-number-field',
                laneId,
                takeId: before.id,
                field,
                expected: before[field],
                replacement: next[field],
            });
        }
    }
    if (before.selected !== next.selected) {
        operations.push({
            kind: 'take-selected-field',
            laneId,
            takeId: before.id,
            expected: before.selected,
            replacement: next.selected,
        });
    }
    const beforeOffset = optionalNumber(before, 'sourceOffsetBeats');
    const nextOffset = optionalNumber(next, 'sourceOffsetBeats');
    if (!valuesEqual(beforeOffset, nextOffset)) {
        operations.push({
            kind: 'take-source-offset-field',
            laneId,
            takeId: before.id,
            expected: beforeOffset,
            replacement: nextOffset,
        });
    }
    return operations;
}

function captureLaneOperations(before: TakeLane, next: TakeLane): TakeLaneWriteOperation[] {
    const operations: TakeLaneWriteOperation[] = [];
    if (before.trackId !== next.trackId) {
        operations.push({
            kind: 'lane-track-field',
            laneId: before.id,
            expected: before.trackId,
            replacement: next.trackId,
        });
    }
    const beforeAutomation = optionalString(before, 'automationLaneId');
    const nextAutomation = optionalString(next, 'automationLaneId');
    if (!valuesEqual(beforeAutomation, nextAutomation)) {
        operations.push({
            kind: 'lane-automation-field',
            laneId: before.id,
            expected: beforeAutomation,
            replacement: nextAutomation,
        });
    }

    const beforeTakes = new Map(before.takes.map((take) => [take.id, take]));
    const nextTakes = new Map(next.takes.map((take) => [take.id, take]));
    for (const take of before.takes) {
        if (!nextTakes.has(take.id)) {
            operations.push({ kind: 'remove-take', laneId: before.id, takeId: take.id });
        }
    }
    for (const [index, take] of next.takes.entries()) {
        const previous = beforeTakes.get(take.id);
        if (!previous) {
            operations.push({
                kind: 'insert-take',
                laneId: before.id,
                take: cloneValue(take),
                afterTakeId: previousIdentity(next.takes, index),
            });
            continue;
        }
        operations.push(...captureTakeFieldOperations(before.id, previous, take));
    }

    if (!valuesEqual(before.activeCompRegions, next.activeCompRegions)) {
        operations.push({
            kind: 'replace-comp-regions',
            laneId: before.id,
            expected: cloneValue(before.activeCompRegions),
            replacement: cloneValue(next.activeCompRegions),
        });
    }
    return operations;
}

function captureDelta(before: TakeLaneStoreValue | null, next: TakeLaneStoreValue | null): TakeLaneWriteJournal {
    if (before === null || next === null) {
        return [{ kind: 'replace-state', expected: cloneValue(before), replacement: cloneValue(next) }];
    }
    const operations: TakeLaneWriteOperation[] = [];
    const beforeLanes = new Map(before.lanes.map((lane) => [lane.id, lane]));
    const nextLanes = new Map(next.lanes.map((lane) => [lane.id, lane]));
    for (const lane of before.lanes) {
        if (!nextLanes.has(lane.id)) {
            operations.push({ kind: 'remove-lane', laneId: lane.id });
        }
    }
    for (const [index, lane] of next.lanes.entries()) {
        const previous = beforeLanes.get(lane.id);
        if (!previous) {
            operations.push({
                kind: 'insert-lane',
                lane: cloneValue(lane),
                afterLaneId: previousIdentity(next.lanes, index),
            });
            continue;
        }
        operations.push(...captureLaneOperations(previous, lane));
    }
    return operations;
}

export function runWithTakeLaneWriteIntent<Result>(intent: TakeLaneWriteIntent, callback: () => Result): Result {
    const previousIntent = pendingWriteIntent;
    pendingWriteIntent = cloneValue(intent);
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
    const intent = pendingWriteIntent;
    pendingWriteIntent = undefined;
    if (intent?.kind === 'comp-region-interval') {
        return [{ kind: 'comp-region-interval', patch: cloneValue(intent.patch) }];
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

function applyCompRegionPatch(state: TakeLaneStoreValue, patch: TakeLaneCompRegionPatch): TakeLaneStoreValue | null {
    const matchingLanes = state.lanes.filter((lane) => lane.trackId === patch.trackId);
    const lane = matchingLanes.length === 1 && matchingLanes[0]?.id === patch.laneId ? matchingLanes[0] : undefined;
    if (!lane) {
        return null;
    }
    const takeIds = new Set(lane.takes.map((take) => take.id));
    if (
        ![...patch.expected, ...patch.replacement].every((span) => takeIds.has(span.takeId)) ||
        !valuesEqual(captureCompSelection(lane.activeCompRegions, patch.startBeat, patch.endBeat), patch.expected)
    ) {
        return null;
    }
    const lanes = state.lanes.map((candidate) => {
        if (candidate.id !== patch.laneId) {
            return candidate;
        }
        const retained = candidate.activeCompRegions.flatMap((region) => {
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
        return {
            ...candidate,
            activeCompRegions: coalesceSelection(
                [...retained, ...patch.replacement.map(cloneValue)].sort(
                    (left, right) => left.startBeat - right.startBeat
                ),
                (beat) => beat >= patch.startBeat && beat <= patch.endBeat
            ),
        };
    });
    return { lanes };
}

function findLane(state: TakeLaneStoreValue, laneId: string): TakeLane | undefined {
    return state.lanes.find((lane) => lane.id === laneId);
}

function findTake(lane: TakeLane, takeId: string): Take | undefined {
    return lane.takes.find((take) => take.id === takeId);
}

function insertAfter<T extends { readonly id: string }>(items: readonly T[], item: T, afterId: string | null): T[] {
    const result = [...items];
    const afterIndex = afterId === null ? -1 : result.findIndex((candidate) => candidate.id === afterId);
    result.splice(afterIndex < 0 ? 0 : afterIndex + 1, 0, cloneValue(item));
    return result;
}

function replaceLane(state: TakeLaneStoreValue, replacement: TakeLane): TakeLaneStoreValue {
    return { lanes: state.lanes.map((lane) => (lane.id === replacement.id ? replacement : lane)) };
}

function applyOperation(
    current: TakeLaneStoreValue | null,
    operation: TakeLaneWriteOperation
): TakeLaneStoreValue | null | undefined {
    if (operation.kind === 'replace-state') {
        return valuesEqual(current, operation.expected) ? cloneValue(operation.replacement) : undefined;
    }
    if (current === null) {
        return undefined;
    }
    if (operation.kind === 'comp-region-interval') {
        return applyCompRegionPatch(current, operation.patch) ?? undefined;
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
    if (operation.kind === 'lane-track-field') {
        if (lane.trackId !== operation.expected) {
            return undefined;
        }
        return replaceLane(current, { ...lane, trackId: operation.replacement });
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
        return replaceLane(current, replacement);
    }
    if (operation.kind === 'insert-take') {
        if (findTake(lane, operation.take.id)) {
            return undefined;
        }
        return replaceLane(current, {
            ...lane,
            takes: insertAfter(lane.takes, operation.take, operation.afterTakeId),
        });
    }
    if (operation.kind === 'remove-take') {
        if (!findTake(lane, operation.takeId)) {
            return undefined;
        }
        return replaceLane(current, { ...lane, takes: lane.takes.filter((take) => take.id !== operation.takeId) });
    }
    if (operation.kind === 'replace-comp-regions') {
        if (!valuesEqual(lane.activeCompRegions, operation.expected)) {
            return undefined;
        }
        return replaceLane(current, { ...lane, activeCompRegions: operation.replacement.map(cloneValue) });
    }
    const take = findTake(lane, operation.takeId);
    if (!take) {
        return undefined;
    }
    let replacementTake: Take;
    if (operation.kind === 'take-source-offset-field') {
        if (!valuesEqual(optionalNumber(take, 'sourceOffsetBeats'), operation.expected)) {
            return undefined;
        }
        replacementTake = cloneValue(take);
        if (operation.replacement.present) {
            replacementTake.sourceOffsetBeats = operation.replacement.value;
        } else {
            delete replacementTake.sourceOffsetBeats;
        }
    } else if (operation.kind === 'take-selected-field') {
        if (take.selected !== operation.expected) {
            return undefined;
        }
        replacementTake = { ...take, selected: operation.replacement };
    } else if (operation.kind === 'take-string-field') {
        if (take[operation.field] !== operation.expected) {
            return undefined;
        }
        replacementTake = { ...take, [operation.field]: operation.replacement };
    } else {
        if (take[operation.field] !== operation.expected) {
            return undefined;
        }
        replacementTake = { ...take, [operation.field]: operation.replacement };
    }
    return replaceLane(current, {
        ...lane,
        takes: lane.takes.map((candidate) => (candidate.id === take.id ? replacementTake : candidate)),
    });
}

export function replayTakeLaneWriteJournal(
    authority: TakeLaneStoreValue | null,
    journal: TakeLaneWriteJournal
): { readonly status: 'applied'; readonly value: TakeLaneStoreValue | null } | { readonly status: 'conflict' } {
    let value = cloneValue(authority);
    for (const operation of journal) {
        const next = applyOperation(value, operation);
        if (next === undefined) {
            return { status: 'conflict' };
        }
        value = next;
    }
    return { status: 'applied', value };
}

export function applyTakeLaneCompRegionPatch(
    state: TakeLaneStoreValue,
    patch: TakeLaneCompRegionPatch
): TakeLaneStoreValue | null {
    return applyCompRegionPatch(state, patch);
}

export function takeLaneValuesEqual(left: unknown, right: unknown): boolean {
    return valuesEqual(left, right);
}
