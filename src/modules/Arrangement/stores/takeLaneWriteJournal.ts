import {
    AutomergeStorageWriteConflictError,
    getCurrentAutomergeStorageMutationOwner,
} from '#/infra/store/storage/createAutomergeStorage';
import { isFrozenMidiTakeSource } from '#/modules/MIDI/stores';
import {
    type CompAudioSourcePromotionSnapshot,
    type CompAudioSourceFieldPresenceSnapshot,
} from '#/utils/handlerContract';

import {
    applyCompAudioSourcePromotions,
    compSelectionMatchesSources,
    type CompAudioSourceAuthorization,
} from './compAudioSourcePromotions';
import { type CompAudioSourceInputContext } from './compAudioSourceInputs';
import { projectTempoAudioSourceLanes } from './tempoAudioSources';
import { tempoAudioSourceWriteIntentMatches, type TempoAudioSourceWriteIntent } from './tempoAudioSourceWriteIntent';
import {
    captureBaseGapAudioSources,
    replaceBaseGapAudioSources,
    reconcileBaseGapAudioSourceDelta,
    type OptionalAudioSourceTiles,
} from './baseGapAudioSourceDelta';

import { type CompRegion, type MidiTakeSource, type Take, type TakeLane } from '../models/TakeLane';

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
    readonly audioSourcePromotions?: readonly CompAudioSourcePromotionSnapshot[];
    readonly baseGapAudioSourceFieldPresence?: CompAudioSourceFieldPresenceSnapshot;
};

export {
    captureBaseGapAudioSources,
    replaceBaseGapAudioSources,
    type OptionalAudioSourceTiles,
} from './baseGapAudioSourceDelta';

type OptionalStringValue = { readonly present: false } | { readonly present: true; readonly value: string };

type OptionalNumberValue = { readonly present: false } | { readonly present: true; readonly value: number };
type OptionalMidiSourceValue = { readonly present: false } | { readonly present: true; readonly value: MidiTakeSource };

type OptionalTakeNumberField =
    | 'sourceOffsetBeats'
    | 'sourceOffsetSeconds'
    | 'passAnchorSeconds'
    | 'passDepthSeconds'
    | 'passSourceEndSeconds'
    | 'passOriginBeat'
    | 'passOriginSourceSeconds'
    | 'recordingPassIndex';

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
          readonly kind: 'take-optional-number-field';
          readonly laneId: string;
          readonly takeId: string;
          readonly field: OptionalTakeNumberField;
          readonly expected: OptionalNumberValue;
          readonly replacement: OptionalNumberValue;
      }
    | {
          readonly kind: 'take-midi-source-field';
          readonly laneId: string;
          readonly takeId: string;
          readonly expected: OptionalMidiSourceValue;
          readonly replacement: OptionalMidiSourceValue;
      }
    | {
          readonly kind: 'take-midi-source-phase';
          readonly laneId: string;
          readonly takeId: string;
          readonly expected: number;
          readonly replacement: number;
      }
    | {
          readonly kind: 'take-midi-source-note-row';
          readonly laneId: string;
          readonly takeId: string;
          readonly expected: MidiTakeSource['rows']['notes']['value'][number] | null;
          readonly replacement: MidiTakeSource['rows']['notes']['value'][number] | null;
          readonly expectedSlotPresent: boolean;
          readonly replacementSlotPresent: boolean;
      }
    | {
          readonly kind: 'take-midi-source-cc-row';
          readonly laneId: string;
          readonly takeId: string;
          readonly expected: MidiTakeSource['rows']['controlChanges']['value'][number] | null;
          readonly replacement: MidiTakeSource['rows']['controlChanges']['value'][number] | null;
          readonly expectedSlotPresent: boolean;
          readonly replacementSlotPresent: boolean;
      }
    | {
          readonly kind: 'take-midi-source-bend-row';
          readonly laneId: string;
          readonly takeId: string;
          readonly expected: MidiTakeSource['rows']['pitchBends']['value'][number] | null;
          readonly replacement: MidiTakeSource['rows']['pitchBends']['value'][number] | null;
          readonly expectedSlotPresent: boolean;
          readonly replacementSlotPresent: boolean;
      };

export type TakeLaneWriteOperation =
    | { readonly kind: 'tempo-audio-sources'; readonly intent: TempoAudioSourceWriteIntent }
    | {
          readonly kind: 'replace-state';
          readonly expected: TakeLaneStoreValue | null;
          readonly replacement: TakeLaneStoreValue | null;
      }
    | {
          readonly kind: 'comp-region-interval';
          readonly patch: TakeLaneCompRegionPatch;
          readonly sourceAuthorizations?: readonly CompAudioSourceAuthorization[];
      }
    | {
          readonly kind: 'replace-base-gap-audio-sources';
          readonly laneId: string;
          readonly expected: OptionalAudioSourceTiles;
          readonly replacement: OptionalAudioSourceTiles;
      }
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
    | { readonly kind: 'tempo-audio-sources'; readonly intent: TempoAudioSourceWriteIntent }
    | {
          readonly kind: 'comp-region-interval';
          readonly patch: TakeLaneCompRegionPatch;
          readonly sourceAuthorizations?: readonly CompAudioSourceAuthorization[];
      }
    | { readonly kind: 'replace-state' };

type LaneWriteOperation = Exclude<
    TakeLaneWriteOperation,
    | { readonly kind: 'replace-state' }
    | { readonly kind: 'comp-region-interval' }
    | { readonly kind: 'tempo-audio-sources' }
    | { readonly kind: 'insert-lane' }
    | { readonly kind: 'remove-lane' }
>;

let pendingWriteIntent: { readonly intent: TakeLaneWriteIntent; readonly owner: object | undefined } | undefined;

function cloneValue<Value>(value: Value): Value {
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

function optionalNumber(source: Take, field: OptionalTakeNumberField): OptionalNumberValue {
    if (Object.hasOwn(source, field) && source[field] !== undefined) {
        return { present: true, value: source[field] };
    }
    return { present: false };
}

function optionalMidiSource(take: Take): OptionalMidiSourceValue {
    return take.midiSource === undefined ? { present: false } : { present: true, value: cloneValue(take.midiSource) };
}

function previousIdentity<Item extends { readonly id: string }>(items: readonly Item[], index: number): string | null {
    return index > 0 ? (items[index - 1]?.id ?? null) : null;
}

function changedMidiRows<Row extends { readonly id: string }>(
    before: { readonly present: boolean; readonly value: readonly Row[] },
    next: { readonly present: boolean; readonly value: readonly Row[] },
    operation: (
        expected: Row | null,
        replacement: Row | null,
        expectedSlotPresent: boolean,
        replacementSlotPresent: boolean
    ) => TakeFieldOperation
): TakeFieldOperation[] | null {
    if (valuesEqual(before, next)) {
        return [];
    }
    const previous = before.value;
    const following = next.value;
    if (previous.length === following.length && previous.every((row, index) => row.id === following[index]?.id)) {
        const changed = previous.flatMap((row, index) =>
            valuesEqual(row, following[index]) ? [] : [{ expected: row, replacement: following[index]! }]
        );
        return changed.length === 1
            ? [
                  operation(
                      cloneValue(changed[0]!.expected),
                      cloneValue(changed[0]!.replacement),
                      before.present,
                      next.present
                  ),
              ]
            : null;
    }
    if (following.length === previous.length + 1 && valuesEqual(previous, following.slice(0, -1))) {
        return [operation(null, cloneValue(following[following.length - 1]!), before.present, next.present)];
    }
    if (previous.length === following.length + 1) {
        for (const row of previous) {
            if (
                valuesEqual(
                    previous.filter((candidate) => candidate.id !== row.id),
                    following
                )
            ) {
                return [operation(cloneValue(row), null, before.present, next.present)];
            }
        }
    }
    return null;
}

function captureMidiSourceRowOperations(
    laneId: string,
    takeId: string,
    before: MidiTakeSource,
    next: MidiTakeSource
): TakeFieldOperation[] | null {
    if (!valuesEqual({ ...before, rows: null }, { ...next, rows: null })) {
        return null;
    }
    const beforeRows = before.rows;
    const nextRows = next.rows;
    const notes = changedMidiRows(
        beforeRows.notes,
        nextRows.notes,
        (expected, replacement, expectedSlotPresent, replacementSlotPresent) => ({
            kind: 'take-midi-source-note-row',
            laneId,
            takeId,
            expected,
            replacement,
            expectedSlotPresent,
            replacementSlotPresent,
        })
    );
    const controllers = changedMidiRows(
        beforeRows.controlChanges,
        nextRows.controlChanges,
        (expected, replacement, expectedSlotPresent, replacementSlotPresent) => ({
            kind: 'take-midi-source-cc-row',
            laneId,
            takeId,
            expected,
            replacement,
            expectedSlotPresent,
            replacementSlotPresent,
        })
    );
    const bends = changedMidiRows(
        beforeRows.pitchBends,
        nextRows.pitchBends,
        (expected, replacement, expectedSlotPresent, replacementSlotPresent) => ({
            kind: 'take-midi-source-bend-row',
            laneId,
            takeId,
            expected,
            replacement,
            expectedSlotPresent,
            replacementSlotPresent,
        })
    );
    return notes && controllers && bends ? [...notes, ...controllers, ...bends] : null;
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
    for (const field of [
        'sourceOffsetBeats',
        'sourceOffsetSeconds',
        'passAnchorSeconds',
        'passDepthSeconds',
        'passSourceEndSeconds',
        'passOriginBeat',
        'passOriginSourceSeconds',
        'recordingPassIndex',
    ] as const) {
        const beforeValue = optionalNumber(before, field);
        const nextValue = optionalNumber(next, field);
        if (!valuesEqual(beforeValue, nextValue)) {
            operations.push({
                kind: 'take-optional-number-field',
                laneId,
                takeId: before.id,
                field,
                expected: beforeValue,
                replacement: nextValue,
            });
        }
    }
    const beforeMidiSource = optionalMidiSource(before);
    const nextMidiSource = optionalMidiSource(next);
    if (!valuesEqual(beforeMidiSource, nextMidiSource)) {
        if (
            beforeMidiSource.present &&
            nextMidiSource.present &&
            valuesEqual({ ...beforeMidiSource.value, phaseHeadBeat: 0 }, { ...nextMidiSource.value, phaseHeadBeat: 0 })
        ) {
            operations.push({
                kind: 'take-midi-source-phase',
                laneId,
                takeId: before.id,
                expected: beforeMidiSource.value.phaseHeadBeat,
                replacement: nextMidiSource.value.phaseHeadBeat,
            });
        } else if (beforeMidiSource.present && nextMidiSource.present) {
            const rowOperations = captureMidiSourceRowOperations(
                laneId,
                before.id,
                beforeMidiSource.value,
                nextMidiSource.value
            );
            if (rowOperations) {
                operations.push(...rowOperations);
            } else {
                operations.push({
                    kind: 'take-midi-source-field',
                    laneId,
                    takeId: before.id,
                    expected: beforeMidiSource,
                    replacement: nextMidiSource,
                });
            }
        } else {
            operations.push({
                kind: 'take-midi-source-field',
                laneId,
                takeId: before.id,
                expected: beforeMidiSource,
                replacement: nextMidiSource,
            });
        }
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
    const beforeGaps = captureBaseGapAudioSources(before);
    const nextGaps = captureBaseGapAudioSources(next);
    if (!valuesEqual(beforeGaps, nextGaps)) {
        operations.push({
            kind: 'replace-base-gap-audio-sources',
            laneId: before.id,
            expected: beforeGaps,
            replacement: nextGaps,
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

function replaceCapturedMidiRow<Row extends { readonly id: string }>(
    rows: readonly Row[],
    expected: Row | null,
    replacement: Row | null
): Row[] | null {
    if (expected === null && replacement === null) {
        return null;
    }
    if (expected === null) {
        return replacement && !rows.some((row) => row.id === replacement.id)
            ? [...rows, cloneValue(replacement)]
            : null;
    }
    if (replacement !== null && expected.id !== replacement.id) {
        return null;
    }
    const index = rows.findIndex((row) => row.id === expected.id);
    if (index < 0 || !valuesEqual(rows[index], expected)) {
        return null;
    }
    if (replacement === null) {
        return rows.filter((_, rowIndex) => rowIndex !== index);
    }
    return rows.map((row, rowIndex) => (rowIndex === index ? cloneValue(replacement) : row));
}

function applyTakeFieldOperation(
    state: TakeLaneStoreValue,
    lane: TakeLane,
    operation: TakeFieldOperation
): TakeLaneStoreValue | undefined {
    const take = findTake(lane, operation.takeId);
    if (!take) {
        return undefined;
    }
    let replacementTake: Take;
    if (operation.kind === 'take-optional-number-field') {
        if (!valuesEqual(optionalNumber(take, operation.field), operation.expected)) {
            return undefined;
        }
        replacementTake = cloneValue(take);
        if (operation.replacement.present) {
            replacementTake[operation.field] = operation.replacement.value;
        } else {
            delete replacementTake[operation.field];
        }
    } else if (operation.kind === 'take-midi-source-phase') {
        if (!take.midiSource || !Object.is(take.midiSource.phaseHeadBeat, operation.expected)) {
            return undefined;
        }
        replacementTake = {
            ...take,
            midiSource: { ...take.midiSource, phaseHeadBeat: operation.replacement },
        };
    } else if (operation.kind === 'take-midi-source-field') {
        if (!valuesEqual(optionalMidiSource(take), operation.expected)) {
            return undefined;
        }
        replacementTake = cloneValue(take);
        if (operation.replacement.present) {
            replacementTake.midiSource = cloneValue(operation.replacement.value);
        } else {
            delete replacementTake.midiSource;
        }
    } else if (operation.kind === 'take-midi-source-note-row') {
        const source = take.midiSource;
        if (!source || source.rows.notes.present !== operation.expectedSlotPresent) {
            return undefined;
        }
        const value = replaceCapturedMidiRow(source.rows.notes.value, operation.expected, operation.replacement);
        if (!value || (!operation.replacementSlotPresent && value.length > 0)) {
            return undefined;
        }
        const midiSource = {
            ...source,
            rows: { ...source.rows, notes: { present: operation.replacementSlotPresent, value } },
        };
        if (!isFrozenMidiTakeSource(midiSource)) {
            return undefined;
        }
        replacementTake = { ...take, midiSource };
    } else if (operation.kind === 'take-midi-source-cc-row') {
        const source = take.midiSource;
        if (!source || source.rows.controlChanges.present !== operation.expectedSlotPresent) {
            return undefined;
        }
        const value = replaceCapturedMidiRow(
            source.rows.controlChanges.value,
            operation.expected,
            operation.replacement
        );
        if (!value || (!operation.replacementSlotPresent && value.length > 0)) {
            return undefined;
        }
        const midiSource = {
            ...source,
            rows: { ...source.rows, controlChanges: { present: operation.replacementSlotPresent, value } },
        };
        if (!isFrozenMidiTakeSource(midiSource)) {
            return undefined;
        }
        replacementTake = { ...take, midiSource };
    } else if (operation.kind === 'take-midi-source-bend-row') {
        const source = take.midiSource;
        if (!source || source.rows.pitchBends.present !== operation.expectedSlotPresent) {
            return undefined;
        }
        const value = replaceCapturedMidiRow(source.rows.pitchBends.value, operation.expected, operation.replacement);
        if (!value || (!operation.replacementSlotPresent && value.length > 0)) {
            return undefined;
        }
        const midiSource = {
            ...source,
            rows: { ...source.rows, pitchBends: { present: operation.replacementSlotPresent, value } },
        };
        if (!isFrozenMidiTakeSource(midiSource)) {
            return undefined;
        }
        replacementTake = { ...take, midiSource };
    } else if (operation.kind === 'take-selected-field') {
        if (take.selected !== operation.expected) {
            return undefined;
        }
        replacementTake = { ...take, selected: operation.replacement };
    } else {
        if (take[operation.field] !== operation.expected) {
            return undefined;
        }
        replacementTake = { ...take, [operation.field]: operation.replacement };
    }
    return replaceLane(state, {
        ...lane,
        takes: lane.takes.map((candidate) => (candidate.id === take.id ? replacementTake : candidate)),
    });
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
