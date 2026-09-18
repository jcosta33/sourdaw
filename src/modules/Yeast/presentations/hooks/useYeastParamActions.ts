import { useRef, useState } from 'react';

import { logger } from '#/infra/logger/appLogger';
import { executeUserAppAction } from '#/modules/Command/useCases';

import { yeastStore } from '../../stores/yeastStore';
import { setYeastGrooveTemplate } from '../../useCases/setYeastGrooveTemplate';
import { GROOVE_AMOUNT_PARAM, setYeastProcessorParam } from '../../useCases/setYeastProcessorParam';

/**
 * How soon after a settled gesture a NEW gesture may coalesce into the same
 * undo group. One drag is one gesture and one undo unit; two drags in quick
 * succession read as one musical move. Without the window a knob correction
 * minutes later would merge into a stale group and one undo would revert two
 * unrelated moves. Same rule the mixer strip faders use.
 */
const SETTLE_COALESCE_WINDOW_MS = 500;

/** One gesture display slot, keyed by `processorId:paramId`. */
function paramKey(processorId: string, paramId: string): string {
    return `${processorId}:${paramId}`;
}

function readLiveParam(processorId: string, paramId: string): number | undefined {
    const processor = yeastStore.value?.processors.find((candidate) => candidate.id === processorId);
    return processor?.params?.[paramId];
}

export type YeastParamActions = {
    /**
     * The params a processor's knobs should draw: the open gesture's sample
     * overlays project truth, because truth is not written until the gesture
     * settles and a controlled knob would otherwise freeze under the user's
     * thumb. With no open gesture the input reference comes back untouched.
     */
    displayParams: (
        processorId: string,
        params: Record<string, number> | undefined
    ) => Record<string, number> | undefined;
    /** The value one knob should draw, overlay included. */
    displayValue: (processorId: string, paramId: string, committedValue: number) => number;
    /**
     * The knob contract: transient pointer samples drive the audio preview
     * only — never a dispatch — and the settled value dispatches the guarded
     * `setYeastProcessorParam` action once, with `expectedValue` read at
     * commit time. One drag lands as one Automerge write and one undo entry.
     *
     * The verb is deliberately NOT `set…Param`: the Arrangement knob census
     * (`declaredRangeVsKnobTravel.spec.ts`) reads a `set…Param('id', …)` call
     * shape in a panel's source as a binding to that device descriptor's
     * parameter, and Yeast knobs drive per-processor rack parameters the
     * device descriptor does not declare — that shape would move every
     * converted knob from the census's honest `unbound` count into phantom
     * stray bindings.
     */
    applyParam: (processorId: string, paramId: string, value: number, isTransient?: boolean) => void;
    /**
     * The groove-amount knob's route. Transient samples preview exactly like
     * `setParam`; the settle dispatches `setYeastGrooveTemplate`, whose own
     * `assignGrooveTemplate` action is the ONE undo entry for the gesture —
     * the param action must never fire for this parameter beside it (#2111).
     */
    setGrooveAmount: (
        processorId: string,
        templateId: string,
        amount: number | undefined,
        isTransient?: boolean
    ) => void;
};

/**
 * Presentation facade binding Yeast knobs to the guarded, undoable param
 * actions. Gesture display state and settle coalescing live here, mirroring
 * `useChannelStripActions`: the strip writes truth once per gesture, keeps the
 * knob drawing the thumb value until the write lands, and merges gestures that
 * follow within the coalescing window into one undo group.
 */
export function useYeastParamActions(): YeastParamActions {
    const [gestureValues, setGestureValues] = useState<ReadonlyMap<string, number>>(new Map());
    const openKeys = useRef(new Set<string>());
    const lastSettleTimes = useRef(new Map<string, number>());
    const displayTokens = useRef(new Map<string, number>());
    const pendingCommits = useRef(new Map<string, Promise<void>>());

    const showGestureValue = (key: string, value: number): void => {
        displayTokens.current.set(key, (displayTokens.current.get(key) ?? 0) + 1);
        setGestureValues((previous) => new Map(previous).set(key, value));
    };

    /** Drops the overlay only if no newer sample has taken over the slot — a
     *  still-in-flight commit must never clobber the gesture that replaced it
     *  (the strip's `settleContinuation`, keyed per parameter). */
    const settleDisplay = (key: string): void => {
        const settledToken = displayTokens.current.get(key);
        setGestureValues((previous) => {
            if (displayTokens.current.get(key) !== settledToken) {
                return previous;
            }
            const next = new Map(previous);
            next.delete(key);
            return next;
        });
    };

    const queueCommit = (key: string, dispatch: () => Promise<void>): void => {
        const previous = pendingCommits.current.get(key) ?? Promise.resolve();
        const commit = previous
            .catch(() => undefined)
            .then(dispatch)
            .catch((error: unknown) => {
                logger.error(new Error(`Yeast param dispatch failed for ${key}`, { cause: error }));
            })
            .finally(() => settleDisplay(key));
        pendingCommits.current.set(key, commit);
    };

    const displayParams = (processorId: string, params: Record<string, number> | undefined) => {
        const keyPrefix = `${processorId}:`;
        const overlays = [...gestureValues.entries()].filter(([key]) => key.startsWith(keyPrefix));
        if (overlays.length === 0) {
            return params;
        }
        const merged = { ...(params ?? {}) };
        for (const [key, value] of overlays) {
            merged[key.slice(keyPrefix.length)] = value;
        }
        return merged;
    };

    const displayValue = (processorId: string, paramId: string, committedValue: number): number => {
        return gestureValues.get(paramKey(processorId, paramId)) ?? committedValue;
    };

    const applyParam = (processorId: string, paramId: string, value: number, isTransient = false): void => {
        const key = paramKey(processorId, paramId);
        if (isTransient) {
            openKeys.current.add(key);
            showGestureValue(key, value);
            // Preview only: the transient use-case path applies an audio
            // projection and writes no project truth, so nothing here records
            // history. The settle below is the gesture's single dispatch.
            void setYeastProcessorParam(processorId, paramId, value, true).catch(() => undefined);
            return;
        }
        const wasOpen = openKeys.current.delete(key);
        let coalesceWithPrevious = false;
        if (wasOpen) {
            lastSettleTimes.current.set(key, performance.now());
        } else if (performance.now() - (lastSettleTimes.current.get(key) ?? 0) <= SETTLE_COALESCE_WINDOW_MS) {
            coalesceWithPrevious = true;
            lastSettleTimes.current.set(key, 0);
        }
        showGestureValue(key, value);
        queueCommit(key, async () => {
            const expectedValue = readLiveParam(processorId, paramId);
            await executeUserAppAction(
                {
                    type: 'setYeastProcessorParam',
                    payload: { processorId, paramId, value, expectedValue },
                },
                coalesceWithPrevious ? { coalesceWithPrevious: true } : undefined
            );
        });
    };

    const setGrooveAmount = (
        processorId: string,
        templateId: string,
        amount: number | undefined,
        isTransient = false
    ): void => {
        const key = paramKey(processorId, GROOVE_AMOUNT_PARAM);
        if (amount === undefined) {
            // Template selection only — no amount gesture to display.
            void Promise.resolve(setYeastGrooveTemplate(processorId, templateId)).catch(() => undefined);
            return;
        }
        if (isTransient) {
            openKeys.current.add(key);
            showGestureValue(key, amount);
            void setYeastProcessorParam(processorId, GROOVE_AMOUNT_PARAM, amount, true).catch(() => undefined);
            return;
        }
        showGestureValue(key, amount);
        queueCommit(key, async () => {
            await setYeastGrooveTemplate(processorId, templateId, amount);
        });
    };

    return { displayParams, displayValue, applyParam, setGrooveAmount };
}
