import { makeOfflineFrameScheduler } from '../../repositories/offlineScheduler/makeOfflineFrameScheduler';

import { acquireRenderLock } from './acquireRenderLock';
import { buildOfflineWebAudioGraph } from './buildOfflineWebAudioGraph';
import { type captureOfflineRenderInput } from './captureOfflineRenderInput';
import { createOfflineRenderBackend } from './createOfflineRenderBackend';
import { type WebAudioOfflineBackend } from './createWebAudioOfflineBackend';
import { cropHistoryFromRenderedBuffer } from './cropHistoryFromRenderedBuffer';
import { resetCancelFlag } from './resetCancelFlag';
import { resolveOfflineMixPlan } from './resolveOfflineMixPlan';
import { scheduleOfflineMix } from './scheduleOfflineMix';
import { tryNativeOfflineRender } from './tryNativeOfflineRender';
import { type OfflineRenderOptions } from './types';

/** Admission, capture and teardown share one uninterrupted lock ownership boundary. */
export async function executeOfflineRender(
    capture: () => ReturnType<typeof captureOfflineRenderInput>,
    callbacks: Pick<OfflineRenderOptions, 'onProgress' | 'onWarning'> = {}
): Promise<AudioBuffer> {
    const releaseLock = acquireRenderLock();
    // The backend's device map is the scheduler's read model and the sole disposal root.
    // Assign it before any Web Audio preparation can yield or fail.
    let backend: WebAudioOfflineBackend | undefined;
    try {
        resetCancelFlag();
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
            });
            const graph = await buildOfflineWebAudioGraph({
                input,
                plan,
                offlineCtx,
                backend,
                onWarning: callbacks.onWarning,
            });
            buffer = await scheduleOfflineMix({ input, plan, graph, offlineCtx, masterGain, scheduleFrame, callbacks });
        }
        callbacks.onProgress?.(1);
        return cropHistoryFromRenderedBuffer({ buffer, historySeconds, outputDurationSeconds });
    } finally {
        backend?.dispose();
        releaseLock();
    }
}
