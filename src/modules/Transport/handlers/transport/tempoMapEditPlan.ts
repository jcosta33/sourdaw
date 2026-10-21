import {
    type AppAction,
    type HandlerExecutionResult,
    type HandlerSessionActionEntry,
    type TempoAudioSourceTransition,
    type TempoMapEventSnapshot,
} from '#/utils/handlerContract';

import { BEAT_EPSILON, getTempoAtBeat, MAX_TEMPO_MAP_TEMPO, MIN_TEMPO_MAP_TEMPO } from '../../models/TempoMap';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { transportStore } from '../../stores/transportStore';
import { markTempoProjectWrite } from '../../useCases/markTempoProjectWrite';
import { tempoSourceDependencies } from '../../useCases/tempoSourceDependencies';

type ForwardAction = Extract<
    AppAction,
    { type: 'addTempoMapChange' | 'updateTempoMapChange' | 'removeTempoMapChange' }
>;
type RestoreAction = Extract<AppAction, { type: 'restoreTempoMapChange' }>;
type Event = TempoMapEventSnapshot;
type Plan = { before: Event | null; after: Event | null; changes: Event[] };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isValidEvent(value: unknown): value is Event {
    return (
        isRecord(value) &&
        exactKeys(value, ['id', 'beat', 'tempo', 'curve']) &&
        typeof value.id === 'string' &&
        value.id.length > 0 &&
        typeof value.beat === 'number' &&
        Number.isFinite(value.beat) &&
        value.beat >= 0 &&
        typeof value.tempo === 'number' &&
        Number.isFinite(value.tempo) &&
        value.tempo >= MIN_TEMPO_MAP_TEMPO &&
        value.tempo <= MAX_TEMPO_MAP_TEMPO &&
        (value.curve === 'instant' || value.curve === 'linear')
    );
}

function eventEquals(left: Event | null, right: Event | null): boolean {
    return (
        left === right ||
        (left !== null &&
            right !== null &&
            left.id === right.id &&
            Object.is(left.beat, right.beat) &&
            Object.is(left.tempo, right.tempo) &&
            left.curve === right.curve)
    );
}

function isValidPair(expected: unknown, replacement: unknown): boolean {
    return (
        (expected === null || isValidEvent(expected)) &&
        (replacement === null || isValidEvent(replacement)) &&
        (expected !== null || replacement !== null) &&
        (expected === null ||
            replacement === null ||
            (expected.id === replacement.id && Object.is(expected.beat, replacement.beat)))
    );
}

function currentChanges(): readonly Event[] | null {
    const state = tempoMapStore.value;
    return state?.changes ?? null;
}

function withReplacement(changes: readonly Event[], before: Event | null, after: Event | null): Event[] {
    const remaining = before === null ? [...changes] : changes.filter((change) => change.id !== before.id);
    if (after) {
        remaining.push(after);
    }
    return remaining.sort((left, right) => left.beat - right.beat);
}

function validChanges(changes: readonly Event[]): boolean {
    const ids = new Set<string>();
    for (const change of changes) {
        if (!isValidEvent(change) || ids.has(change.id)) {
            return false;
        }
        ids.add(change.id);
    }
    return true;
}

export function materializeAddTempoMapChange(action: Extract<AppAction, { type: 'addTempoMapChange' }>): void {
    if (action.payload.changeId !== undefined) {
        return;
    }
    const matching = currentChanges()?.find((change) => Math.abs(change.beat - action.payload.beat) <= BEAT_EPSILON);
    action.payload.changeId = matching?.id ?? `tempo-${crypto.randomUUID()}`;
}

export function prepareForwardTempoMapEdit(action: ForwardAction): Plan | null {
    const changes = currentChanges();
    if (!changes || !validChanges(changes)) {
        return null;
    }
    let before: Event | null;
    let after: Event | null;
    if (action.type === 'addTempoMapChange') {
        const { beat, tempo, curve, changeId } = action.payload;
        if (!isValidEvent({ id: changeId, beat, tempo, curve })) {
            return null;
        }
        before = changes.find((change) => Math.abs(change.beat - beat) <= BEAT_EPSILON) ?? null;
        if ((before && before.id !== changeId) || (!before && changes.some((change) => change.id === changeId))) {
            return null;
        }
        after = { id: changeId!, beat: before?.beat ?? beat, tempo, curve };
    } else {
        const { changeId } = action.payload;
        if (typeof changeId !== 'string' || changeId.length === 0) {
            return null;
        }
        before = changes.find((change) => change.id === changeId) ?? null;
        if (!before) {
            return null;
        }
        if (action.type === 'removeTempoMapChange') {
            after = null;
        } else {
            const { tempo } = action.payload;
            after = isValidEvent({ ...before, tempo }) ? { ...before, tempo } : null;
            if (!after) {
                return null;
            }
        }
    }
    const next = withReplacement(changes, before, after);
    return validChanges(next) ? { before, after, changes: next } : null;
}

export function prepareReplayTempoMapEdit(action: RestoreAction): Plan | null {
    const { expected, replacement } = action.payload;
    const changes = currentChanges();
    if (!changes || !validChanges(changes) || !isValidPair(expected, replacement)) {
        return null;
    }
    const id = expected?.id ?? replacement!.id;
    const current = changes.find((change) => change.id === id) ?? null;
    if (!eventEquals(current, expected)) {
        return null;
    }
    if (
        expected === null &&
        replacement !== null &&
        changes.some((change) => Math.abs(change.beat - replacement.beat) <= BEAT_EPSILON)
    ) {
        return null;
    }
    const next = withReplacement(changes, expected, replacement);
    return validChanges(next) ? { before: expected, after: replacement, changes: next } : null;
}

function sourceChange(plan: Plan, replay?: TempoAudioSourceTransition) {
    const baseTempo = transportStore.value?.tempo;
    if (!tempoSourceDependencies.available() || baseTempo === undefined || !Number.isFinite(baseTempo)) {
        return null;
    }
    return tempoSourceDependencies.prepare({
        nextTempoAtBeat: (beat) => getTempoAtBeat(plan.changes, beat, baseTempo),
        replay,
    });
}

export function describeForwardTempoMapEdit(action: ForwardAction, label: string) {
    const plan = prepareForwardTempoMapEdit(action);
    const source = plan && sourceChange(plan);
    if (!plan || !source || eventEquals(plan.before, plan.after)) {
        return { label, inverseAction: null };
    }
    return {
        label,
        inverseAction: {
            type: 'restoreTempoMapChange' as const,
            payload: {
                expected: plan.after,
                replacement: plan.before,
                sourceTransition: { ...source.transition, direction: 'restore' as const },
            },
        },
        redoAction: {
            type: 'restoreTempoMapChange' as const,
            payload: {
                expected: plan.before,
                replacement: plan.after,
                sourceTransition: { ...source.transition, direction: 'apply' as const },
            },
        },
    };
}

export function executeTempoMapEdit(plan: Plan | null, replay?: TempoAudioSourceTransition): HandlerExecutionResult {
    if (!plan) {
        return { status: 'conflict' };
    }
    if (eventEquals(plan.before, plan.after)) {
        return { status: 'no-write' };
    }
    const source = sourceChange(plan, replay);
    if (!source || !source.matches()) {
        return { status: 'conflict' };
    }
    tempoMapStore.set({ changes: plan.changes });
    if (!source.apply()) {
        return { status: 'conflict' };
    }
    return { status: 'written', afterCommit: markTempoProjectWrite, afterAmbiguousCommit: markTempoProjectWrite };
}

export function isTempoMapReplayPayload(value: unknown): value is RestoreAction['payload'] {
    if (!isRecord(value) || !exactKeys(value, ['expected', 'replacement', 'sourceTransition'])) {
        return false;
    }
    if (!isValidPair(value.expected, value.replacement)) {
        return false;
    }
    return tempoSourceDependencies.isTransition(value.sourceTransition);
}

function forwardMatchesCapturedEvents(forward: AppAction, before: Event | null, after: Event | null): boolean {
    if (forward.type === 'addTempoMapChange') {
        return (
            typeof forward.payload.changeId === 'string' &&
            after !== null &&
            after.id === forward.payload.changeId &&
            (before === null || Math.abs(before.beat - forward.payload.beat) <= BEAT_EPSILON) &&
            Object.is(after.beat, before?.beat ?? forward.payload.beat) &&
            Object.is(after.tempo, forward.payload.tempo) &&
            after.curve === forward.payload.curve
        );
    }
    if (forward.type === 'updateTempoMapChange') {
        return (
            before !== null &&
            after !== null &&
            before.id === forward.payload.changeId &&
            Object.is(after.tempo, forward.payload.tempo) &&
            before.curve === after.curve
        );
    }
    return (
        forward.type === 'removeTempoMapChange' &&
        before !== null &&
        after === null &&
        before.id === forward.payload.changeId
    );
}

export function isTempoMapEditSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (
        entry.inverseAction?.type !== 'restoreTempoMapChange' ||
        entry.redoAction?.type !== 'restoreTempoMapChange' ||
        !isTempoMapReplayPayload(entry.inverseAction.payload) ||
        !isTempoMapReplayPayload(entry.redoAction.payload)
    ) {
        return false;
    }
    const inverse = entry.inverseAction.payload;
    const redo = entry.redoAction.payload;
    if (
        !eventEquals(inverse.expected, redo.replacement) ||
        !eventEquals(inverse.replacement, redo.expected) ||
        inverse.sourceTransition.direction !== 'restore' ||
        redo.sourceTransition.direction !== 'apply' ||
        JSON.stringify({ ...inverse.sourceTransition, direction: 'apply' }) !== JSON.stringify(redo.sourceTransition)
    ) {
        return false;
    }
    return forwardMatchesCapturedEvents(entry.action, inverse.replacement, inverse.expected);
}
