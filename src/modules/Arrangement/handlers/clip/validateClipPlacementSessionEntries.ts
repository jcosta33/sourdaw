import { isExactClipAutomationMoveSnapshots } from '#/modules/Automation/useCases';
import { type HandlerSessionActionEntry } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { hasFiniteNumbers } from './hasFiniteNumbers';

function isPlacementOrder(value: Record<string, unknown>, clipId: string): boolean {
    const hasIndex = Object.hasOwn(value, 'clipIndex');
    const hasBefore = Object.hasOwn(value, 'beforeClipId');
    const hasAfter = Object.hasOwn(value, 'afterClipId');
    if (!hasIndex) {
        return !hasBefore && !hasAfter;
    }
    if (typeof value.clipIndex !== 'number' || !Number.isSafeInteger(value.clipIndex) || value.clipIndex < 0) {
        return false;
    }
    if (hasBefore !== value.clipIndex > 0) {
        return false;
    }
    return (
        (!hasBefore || (typeof value.beforeClipId === 'string' && value.beforeClipId.length > 0)) &&
        (!hasAfter || (typeof value.afterClipId === 'string' && value.afterClipId.length > 0)) &&
        value.beforeClipId !== clipId &&
        value.afterClipId !== clipId &&
        (!hasBefore || !hasAfter || value.beforeClipId !== value.afterClipId)
    );
}

function isPlacement(value: unknown, clipId: string): boolean {
    return (
        isRecord(value) &&
        typeof value.trackId === 'string' &&
        value.trackId.length > 0 &&
        typeof value.startBeat === 'number' &&
        Number.isFinite(value.startBeat) &&
        value.startBeat >= 0 &&
        typeof value.endBeat === 'number' &&
        Number.isFinite(value.endBeat) &&
        value.endBeat > value.startBeat &&
        isExactClipAutomationMoveSnapshots(value.automationLanes) &&
        value.automationLanes.every((lane) => lane.trackId === value.trackId) &&
        hasFiniteNumbers(value.automationLanes) &&
        isPlacementOrder(value, clipId)
    );
}

export function isRestoreClipPlacementSessionPayload(value: unknown): boolean {
    return (
        isRecord(value) &&
        typeof value.clipId === 'string' &&
        value.clipId.length > 0 &&
        isPlacement(value.expected, value.clipId) &&
        isPlacement(value.replacement, value.clipId)
    );
}

export function isMoveClipSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (
        entry.action.type !== 'moveClip' ||
        entry.inverseAction?.type !== 'restoreClipPlacement' ||
        entry.redoAction?.type !== 'restoreClipPlacement'
    ) {
        return false;
    }
    const action = entry.action.payload;
    const inverse = entry.inverseAction.payload;
    const redo = entry.redoAction.payload;
    return (
        action.clipId === inverse.clipId &&
        action.clipId === redo.clipId &&
        isRestoreClipPlacementSessionPayload(inverse) &&
        isRestoreClipPlacementSessionPayload(redo) &&
        inverse.expected.trackId === action.trackId &&
        inverse.expected.startBeat === action.startBeat &&
        Object.hasOwn(inverse.expected, 'clipIndex') === Object.hasOwn(inverse.replacement, 'clipIndex') &&
        inverse.expected.endBeat === action.startBeat + (inverse.replacement.endBeat - inverse.replacement.startBeat) &&
        valuesEqual(inverse.expected, redo.replacement) &&
        valuesEqual(inverse.replacement, redo.expected)
    );
}
