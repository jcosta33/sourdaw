import { type CompSelectionSpanSnapshot } from '#/utils/handlerContract';

import { takeLaneStore } from '../../stores/takeLaneStore';
import {
    applyTakeLaneCompRegionPatch,
    captureCompSelection,
    runWithTakeLaneWriteIntent,
    type TakeLaneCompRegionPatch,
} from '../../stores/takeLaneWriteJournal';

export type CompRegionIntervalPatch = TakeLaneCompRegionPatch;

function isValidInterval(startBeat: number, endBeat: number): boolean {
    return Number.isFinite(startBeat) && Number.isFinite(endBeat) && startBeat >= 0 && endBeat > startBeat;
}

function selectionsEqual(
    alpha: readonly CompSelectionSpanSnapshot[],
    beta: readonly CompSelectionSpanSnapshot[]
): boolean {
    return (
        alpha.length === beta.length &&
        alpha.every(
            (span, index) =>
                span.startBeat === beta[index]?.startBeat &&
                span.endBeat === beta[index]?.endBeat &&
                span.takeId === beta[index]?.takeId
        )
    );
}

function hasExactSpanKeys(span: object): boolean {
    const keys = Object.keys(span);
    return keys.length === 3 && keys.includes('startBeat') && keys.includes('endBeat') && keys.includes('takeId');
}

function isValidSelectionSpan(input: {
    readonly span: unknown;
    readonly startBeat: number;
    readonly endBeat: number;
    readonly previousEnd: number;
    readonly previousTakeId: string | undefined;
}): input is typeof input & { readonly span: CompSelectionSpanSnapshot } {
    const { span, startBeat, endBeat, previousEnd, previousTakeId } = input;
    if (!span || typeof span !== 'object') {
        return false;
    }
    if (!('startBeat' in span) || !('endBeat' in span) || !('takeId' in span)) {
        return false;
    }
    if (typeof span.startBeat !== 'number' || typeof span.endBeat !== 'number' || typeof span.takeId !== 'string') {
        return false;
    }
    return (
        hasExactSpanKeys(span) &&
        span.takeId.length > 0 &&
        Number.isFinite(span.startBeat) &&
        Number.isFinite(span.endBeat) &&
        span.startBeat >= startBeat &&
        span.endBeat <= endBeat &&
        span.startBeat < span.endBeat &&
        span.startBeat >= previousEnd &&
        !(span.startBeat === previousEnd && span.takeId === previousTakeId)
    );
}

function hasValidSnapshot(spans: readonly unknown[], startBeat: number, endBeat: number): boolean {
    let previousEnd = startBeat;
    let previousTakeId: string | undefined;
    for (const span of spans) {
        const input = { span, startBeat, endBeat, previousEnd, previousTakeId };
        if (!isValidSelectionSpan(input)) {
            return false;
        }
        previousEnd = input.span.endBeat;
        previousTakeId = input.span.takeId;
    }
    return true;
}

function captureCompRegionIntervalPatch(input: {
    readonly trackId: string;
    readonly startBeat: number;
    readonly endBeat: number;
    readonly takeId: string;
}): CompRegionIntervalPatch | null {
    if (!isValidInterval(input.startBeat, input.endBeat)) {
        return null;
    }
    const matches = takeLaneStore.value?.lanes.filter((lane) => lane.trackId === input.trackId) ?? [];
    const lane = matches.length === 1 ? matches[0] : undefined;
    if (!lane || !lane.takes.some((take) => take.id === input.takeId)) {
        return null;
    }
    return {
        laneId: lane.id,
        trackId: input.trackId,
        startBeat: input.startBeat,
        endBeat: input.endBeat,
        expected: captureCompSelection(lane.activeCompRegions, input.startBeat, input.endBeat),
        replacement: [{ startBeat: input.startBeat, endBeat: input.endBeat, takeId: input.takeId }],
    };
}

function isCompleteCompRegionIntervalPatch(value: unknown): value is CompRegionIntervalPatch {
    if (!value || typeof value !== 'object') {
        return false;
    }
    if (
        !('laneId' in value) ||
        !('trackId' in value) ||
        !('startBeat' in value) ||
        !('endBeat' in value) ||
        !('expected' in value) ||
        !('replacement' in value)
    ) {
        return false;
    }
    const patch = value;
    return (
        typeof patch.laneId === 'string' &&
        patch.laneId.length > 0 &&
        typeof patch.trackId === 'string' &&
        patch.trackId.length > 0 &&
        typeof patch.startBeat === 'number' &&
        typeof patch.endBeat === 'number' &&
        isValidInterval(patch.startBeat, patch.endBeat) &&
        Array.isArray(patch.expected) &&
        Array.isArray(patch.replacement) &&
        hasValidSnapshot(patch.expected, patch.startBeat, patch.endBeat) &&
        hasValidSnapshot(patch.replacement, patch.startBeat, patch.endBeat)
    );
}

function isCompleteSetCompRegionPayload(
    value: unknown
): value is CompRegionIntervalPatch & { readonly takeId: string } {
    return (
        isCompleteCompRegionIntervalPatch(value) &&
        'takeId' in value &&
        typeof value.takeId === 'string' &&
        value.takeId.length > 0 &&
        Object.keys(value).length === 7
    );
}

function isCompleteRestoreCompRegionIntervalPayload(value: unknown): value is CompRegionIntervalPatch {
    return isCompleteCompRegionIntervalPatch(value) && Object.keys(value).length === 6;
}

function compRegionIntervalPatchApplies(patch: CompRegionIntervalPatch): boolean {
    const state = takeLaneStore.value;
    if (!state || !hasValidSnapshot(patch.expected, patch.startBeat, patch.endBeat)) {
        return false;
    }
    return applyTakeLaneCompRegionPatch(state, patch) !== null;
}

function applyCompRegionIntervalPatch(patch: CompRegionIntervalPatch): 'written' | 'no-write' | 'conflict' {
    const state = takeLaneStore.value;
    if (!state) {
        return 'conflict';
    }
    const next = applyTakeLaneCompRegionPatch(state, patch);
    if (!next) {
        return 'conflict';
    }
    if (selectionsEqual(patch.expected, patch.replacement)) {
        return 'no-write';
    }
    runWithTakeLaneWriteIntent({ kind: 'comp-region-interval', patch }, () => {
        takeLaneStore.set({ lanes: [...next.lanes] });
    });
    return 'written';
}

export const compRegionInterval = {
    applyPatch: applyCompRegionIntervalPatch,
    capturePatch: captureCompRegionIntervalPatch,
    isCompleteRestorePayload: isCompleteRestoreCompRegionIntervalPayload,
    isCompleteSetPayload: isCompleteSetCompRegionPayload,
    patchApplies: compRegionIntervalPatchApplies,
};
