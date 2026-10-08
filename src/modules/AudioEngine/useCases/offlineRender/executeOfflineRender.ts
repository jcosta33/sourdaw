import { createRenderBusyError } from '../../errors/RenderBusyError';
import { makeOfflineFrameScheduler } from '../../repositories/offlineScheduler/makeOfflineFrameScheduler';

import { acquireRenderLock } from './acquireRenderLock';
import { acquireRenderLockFromAgentRender } from './acquireRenderLockFromAgentRender';
import { agentRenderNoun } from './agentRenderNoun';
import { beginExportCancellationScope } from './beginExportCancellationScope';
import { buildOfflineWebAudioGraph } from './buildOfflineWebAudioGraph';
import { canPreemptAgentRender } from './canPreemptAgentRender';
import { type captureOfflineRenderInput } from './captureOfflineRenderInput';
import { createOfflineRenderBackend } from './createOfflineRenderBackend';
import { type WebAudioOfflineBackend } from './createWebAudioOfflineBackend';
import { cropHistoryFromRenderedBuffer } from './cropHistoryFromRenderedBuffer';
import { endExportCancellationScope } from './endExportCancellationScope';
import { resolveOfflineMixPlan } from './resolveOfflineMixPlan';
import { scheduleOfflineMix } from './scheduleOfflineMix';
import { tryNativeOfflineRender } from './tryNativeOfflineRender';
import { type OfflineRenderOptions } from './types';

function withPreemption(preemption: AbortSignal, callerSignal: AbortSignal | undefined): AbortSignal {
    if (callerSignal === undefined) {
        return preemption;
    }
    return AbortSignal.any([preemption, callerSignal]);
}

function combineSignals(...signals: readonly (AbortSignal | undefined)[]): AbortSignal | undefined {
    const present = signals.filter((signal) => signal !== undefined);
    if (present.length === 0) {
        return undefined;
    }
    return AbortSignal.any(present);
}

/**
 * Admission, capture and teardown share one uninterrupted lock ownership boundary, except that a
 * musician's export which finds an agent render, a measurement or a section render, holding the lock
 * first stops it and waits for its release (#4768, #5036); its capture then reads the project once
 * the lock is its own. Agent renders never preempt one another.
 */
export async function executeOfflineRender(
    capture: () => ReturnType<typeof captureOfflineRenderInput>,
    options: Pick<OfflineRenderOptions, 'onProgress' | 'onWarning' | 'abortSignal' | 'lockHolder'> = {}
): Promise<AudioBuffer> {
    const holder = options.lockHolder ?? 'musician-export';
    // An agent render stops on this signal beside its caller's own stop, so a musician's export
    // can end it without raising the process-wide cancel flag every other render reads.
    const preemption = new AbortController();
    let releaseLock: () => void;
    if (holder !== 'musician-export') {
        releaseLock = acquireRenderLock(holder, () => preemption.abort());
    } else if (canPreemptAgentRender()) {
        releaseLock = await acquireRenderLockFromAgentRender();
    } else {
        releaseLock = acquireRenderLock(holder);
    }
    const { abortSignal: callerSignal } = options;
    // The backend's device map is the scheduler's read model and the sole disposal root.
    // Assign it before any Web Audio preparation can yield or fail.
    let backend: WebAudioOfflineBackend | undefined;
    try {
        const abortSignal =
            holder === 'musician-export' ? callerSignal : withPreemption(preemption.signal, callerSignal);
        const callbacks = { ...options, abortSignal };
        // Only a musician's export owns the export cancellation scope (#4440), threaded into the
        // backend so instrument setup aborts at the moment Cancel fires rather than at the next
        // between-track checkpoint. An agent render opens none: a musician's Cancel never reaches it.
        const scopeSignal = holder === 'musician-export' ? beginExportCancellationScope() : undefined;
        // Instrument setup stops at an export cancel or at this render's own stop, whichever comes first.
        const cancellationSignal = combineSignals(scopeSignal, abortSignal);
        const input = capture();
        const { sampleRate, historySeconds, outputDurationSeconds } = input;
        const plan = resolveOfflineMixPlan(input, callbacks.onWarning);
        let buffer = await tryNativeOfflineRender(input, plan, callbacks);
        if (!buffer) {
            const offlineCtx = new OfflineAudioContext(2, plan.frameCount, sampleRate);
            // Device construction and every track share this context’s frame scheduler.
            const scheduleFrame = makeOfflineFrameScheduler(offlineCtx);
            const masterGain = offlineCtx.createGain();
            masterGain.gain.value = plan.masterGainValue;
            masterGain.connect(offlineCtx.destination);
            backend = createOfflineRenderBackend({
                context: offlineCtx,
                masterNode: masterGain,
                onWarning: callbacks.onWarning,
                instruments: input.instruments,
                loadedExternalInstanceIds: input.loadedExternalInstanceIds,
                cancellationSignal,
            });
            const graph = await buildOfflineWebAudioGraph({
                input,
                plan,
                offlineCtx,
                backend,
                onWarning: callbacks.onWarning,
                abortSignal,
            });
            buffer = await scheduleOfflineMix({ input, plan, graph, offlineCtx, masterGain, scheduleFrame, callbacks });
        }
        callbacks.onProgress?.(1);
        return cropHistoryFromRenderedBuffer({ buffer, historySeconds, outputDurationSeconds });
    } catch (error) {
        // A render a musician's export stopped reports why, unless its caller stopped it first.
        if (holder !== 'musician-export' && preemption.signal.aborted && callerSignal?.aborted !== true) {
            throw createRenderBusyError(
                `The assistant's ${agentRenderNoun(holder)} stopped because an export started.`,
                error
            );
        }
        throw error;
    } finally {
        // The mixdown owns its scope's lifetime: a cancelled render's flag must
        // not outlive it (#4782). An agent render never opened one.
        if (holder === 'musician-export') {
            endExportCancellationScope();
        }
        backend?.dispose();
        releaseLock();
    }
}
