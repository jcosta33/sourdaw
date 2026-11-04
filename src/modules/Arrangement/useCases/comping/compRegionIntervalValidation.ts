import { isAudioSourceSnapshot } from '#/utils/audioSourceTime';
import { type CompSelectionSpanSnapshot } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { isValidCompAudioSourcePromotions } from '../../stores/compAudioSourcePromotions';
import { type TakeLaneCompRegionPatch as CompRegionIntervalPatch } from '../../stores/takeLaneWriteJournal';

function isValidInterval(startBeat: number, endBeat: number): boolean {
    return Number.isFinite(startBeat) && Number.isFinite(endBeat) && startBeat >= 0 && endBeat > startBeat;
}

function hasExactSpanKeys(span: object): boolean {
    const keys = Object.keys(span);
    return keys.every((key) => ['startBeat', 'endBeat', 'takeId', 'audioSource'].includes(key));
}

function isAdjacentSameSelection(
    span: { startBeat: number; takeId: string; audioSource: unknown },
    previousEnd: number,
    previousTakeId: string | undefined,
    previousAudioSource: CompSelectionSpanSnapshot['audioSource']
): boolean {
    return (
        span.startBeat === previousEnd &&
        span.takeId === previousTakeId &&
        valuesEqual(span.audioSource, previousAudioSource)
    );
}

function isValidSelectionSpan(input: {
    readonly span: unknown;
    readonly startBeat: number;
    readonly endBeat: number;
    readonly previousEnd: number;
    readonly previousTakeId: string | undefined;
    readonly previousAudioSource: CompSelectionSpanSnapshot['audioSource'];
}): input is typeof input & { readonly span: CompSelectionSpanSnapshot } {
    const { span, startBeat, endBeat, previousEnd, previousTakeId, previousAudioSource } = input;
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
        (!('audioSource' in span) || isAudioSourceSnapshot(span.audioSource)) &&
        span.takeId.length > 0 &&
        Number.isFinite(span.startBeat) &&
        Number.isFinite(span.endBeat) &&
        span.startBeat >= startBeat &&
        span.endBeat <= endBeat &&
        span.startBeat < span.endBeat &&
        span.startBeat >= previousEnd &&
        !isAdjacentSameSelection(
            {
                startBeat: span.startBeat,
                takeId: span.takeId,
                audioSource: 'audioSource' in span ? span.audioSource : undefined,
            },
            previousEnd,
            previousTakeId,
            previousAudioSource
        )
    );
}

function hasValidSnapshot(spans: readonly unknown[], startBeat: number, endBeat: number): boolean {
    let previousEnd = startBeat;
    let previousTakeId: string | undefined;
    let previousAudioSource: CompSelectionSpanSnapshot['audioSource'];
    for (const span of spans) {
        const input = { span, startBeat, endBeat, previousEnd, previousTakeId, previousAudioSource };
        if (!isValidSelectionSpan(input)) {
            return false;
        }
        previousEnd = input.span.endBeat;
        previousTakeId = input.span.takeId;
        previousAudioSource = input.span.audioSource;
    }
    return true;
}

function validPromotions(
    patch: object,
    expectedSpans: readonly unknown[],
    replacementSpans: readonly unknown[],
    interval: { startBeat: number; endBeat: number }
): boolean {
    const { startBeat, endBeat } = interval;
    if ('audioSourcePromotions' in patch) {
        const takeIds = new Set(
            [...expectedSpans, ...replacementSpans].flatMap((span) => {
                if (isRecord(span) && typeof span.takeId === 'string') {
                    return [span.takeId];
                }
                return [];
            })
        );
        const baseGapExposed = [expectedSpans, replacementSpans].some((spans) => {
            const coveredLength = spans.reduce<number>((length, span) => {
                if (isRecord(span) && typeof span.startBeat === 'number' && typeof span.endBeat === 'number') {
                    return length + (span.endBeat - span.startBeat);
                }
                return length;
            }, 0);
            return coveredLength < endBeat - startBeat;
        });
        if (
            !isValidCompAudioSourcePromotions(patch.audioSourcePromotions, {
                startBeat,
                endBeat,
                takeIds,
                baseGapExposed,
            })
        ) {
            return false;
        }
    }
    return true;
}

function hasPatchKeys(
    value: object
): value is object & Record<'laneId' | 'trackId' | 'startBeat' | 'endBeat' | 'expected' | 'replacement', unknown> {
    return !(
        !('laneId' in value) ||
        !('trackId' in value) ||
        !('startBeat' in value) ||
        !('endBeat' in value) ||
        !('expected' in value) ||
        !('replacement' in value)
    );
}

function validFieldPresence(patch: object): boolean {
    if (
        'baseGapAudioSourceFieldPresence' in patch &&
        (patch.baseGapAudioSourceFieldPresence === null ||
            typeof patch.baseGapAudioSourceFieldPresence !== 'object' ||
            Object.keys(patch.baseGapAudioSourceFieldPresence).length !== 2 ||
            !('expected' in patch.baseGapAudioSourceFieldPresence) ||
            typeof patch.baseGapAudioSourceFieldPresence.expected !== 'boolean' ||
            !('replacement' in patch.baseGapAudioSourceFieldPresence) ||
            typeof patch.baseGapAudioSourceFieldPresence.replacement !== 'boolean')
    ) {
        return false;
    }
    return true;
}

function isCompleteCompRegionIntervalPatch(value: unknown): value is CompRegionIntervalPatch {
    if (!value || typeof value !== 'object') {
        return false;
    }
    if (!hasPatchKeys(value)) {
        return false;
    }
    const patch = value;
    const { startBeat, endBeat } = patch;
    if (typeof startBeat !== 'number' || typeof endBeat !== 'number') {
        return false;
    }
    if (typeof patch.laneId !== 'string' || patch.laneId.length === 0) {
        return false;
    }
    if (typeof patch.trackId !== 'string' || patch.trackId.length === 0) {
        return false;
    }
    if (typeof patch.startBeat !== 'number' || typeof patch.endBeat !== 'number') {
        return false;
    }
    if (!isValidInterval(patch.startBeat, patch.endBeat)) {
        return false;
    }
    if (!Array.isArray(patch.expected) || !Array.isArray(patch.replacement)) {
        return false;
    }
    const expectedSpans: readonly unknown[] = patch.expected;
    const replacementSpans: readonly unknown[] = patch.replacement;
    if (!hasValidSnapshot(expectedSpans, patch.startBeat, patch.endBeat)) {
        return false;
    }
    if (!hasValidSnapshot(replacementSpans, patch.startBeat, patch.endBeat)) {
        return false;
    }
    if (!validPromotions(patch, expectedSpans, replacementSpans, { startBeat, endBeat })) {
        return false;
    }
    if (!validFieldPresence(patch)) {
        return false;
    }
    return true;
}

function isCompleteSetCompRegionPayload(
    value: unknown
): value is CompRegionIntervalPatch & { readonly takeId: string } {
    return (
        isCompleteCompRegionIntervalPatch(value) &&
        'takeId' in value &&
        typeof value.takeId === 'string' &&
        value.takeId.length > 0 &&
        value.replacement.length === 1 &&
        value.replacement[0]?.takeId === value.takeId &&
        value.replacement[0].startBeat === value.startBeat &&
        value.replacement[0].endBeat === value.endBeat &&
        Object.keys(value).every((key) =>
            [
                'laneId',
                'trackId',
                'startBeat',
                'endBeat',
                'takeId',
                'expected',
                'replacement',
                'audioSourcePromotions',
                'baseGapAudioSourceFieldPresence',
            ].includes(key)
        )
    );
}

function isCompleteRestoreCompRegionIntervalPayload(value: unknown): value is CompRegionIntervalPatch {
    return (
        isCompleteCompRegionIntervalPatch(value) &&
        Object.keys(value).every((key) =>
            [
                'laneId',
                'trackId',
                'startBeat',
                'endBeat',
                'expected',
                'replacement',
                'audioSourcePromotions',
                'baseGapAudioSourceFieldPresence',
            ].includes(key)
        )
    );
}

function isCompleteRemoveCompRegionPayload(value: unknown): value is CompRegionIntervalPatch {
    return (
        isCompleteRestoreCompRegionIntervalPayload(value) &&
        value.replacement.length === 0 &&
        value.expected.length === 1 &&
        value.expected[0]?.startBeat === value.startBeat &&
        value.expected[0]?.endBeat === value.endBeat
    );
}

export const compRegionIntervalValidation = {
    isValidInterval,
    hasValidSnapshot,
    isCompleteSetCompRegionPayload,
    isCompleteRemoveCompRegionPayload,
    isCompleteRestoreCompRegionIntervalPayload,
};
