import { countRenderFrames, MAX_OFFLINE_FRAMES } from '../../repositories/clampRenderFrameCount';

import { type OfflineRenderProjectSource } from './OfflineRenderSource';
import { resolveRenderContext, type ResolveRenderContextInput } from './resolveRenderContext';

type HistoryAwareRenderContext = {
    renderContext: ReturnType<typeof resolveRenderContext>;
    historySeconds: number;
    outputDurationSeconds: number;
    /** Rendered frames before the requested window: its first frame in the render. */
    historyFrameCount: number;
    /** Frames the requested window keeps, ending on the render's last frame so the tail survives. */
    outputFrameCount: number;
};

/**
 * Resolves a bounded render against timeline zero so stateful devices receive
 * the same prior events as a full playthrough. The requested window remains a
 * separate duration and is cropped only after the graph has rendered.
 *
 * The window is measured in the render's own frames: it starts on the frame the
 * tempo map projects for its first beat and ends on the render's last frame.
 * Counting its length separately from seconds would round floating-point noise
 * on a whole frame up to one frame the render never produced.
 */
export function resolveHistoryAwareRenderContext(
    input: ResolveRenderContextInput,
    source?: OfflineRenderProjectSource
): HistoryAwareRenderContext {
    const resolve = (request: ResolveRenderContextInput) => {
        if (source) {
            return resolveRenderContext(request, source);
        }
        return resolveRenderContext(request);
    };
    const startBeat = input.startBeat ?? 0;
    const sampleRate = input.sampleRate ?? 44_100;
    if (startBeat <= 0) {
        const renderContext = resolve(input);
        return {
            renderContext,
            historySeconds: 0,
            outputDurationSeconds: renderContext.durationSeconds,
            historyFrameCount: 0,
            outputFrameCount: countRenderFrames({ durationSeconds: renderContext.durationSeconds, sampleRate }),
        };
    }

    const renderContext = resolve({
        ...input,
        durationBeats: startBeat + input.durationBeats,
        startBeat: 0,
    });
    const historyProjection = renderContext.projectPpqEndpoints({
        startPpq: 0,
        endPpq: startBeat,
        defaultTempo: renderContext.defaultTempo,
        sampleRate,
        changes: renderContext.changes,
    });
    const historySeconds = Math.max(0, historyProjection.durationSeconds);
    const outputDurationSeconds = Math.max(0, renderContext.durationSeconds - historySeconds);
    const renderFrameCount = countRenderFrames({ durationSeconds: renderContext.durationSeconds, sampleRate });
    const historyFrameCount = Math.round(historySeconds * sampleRate);
    const outputFrameCount = Math.max(0, renderFrameCount - historyFrameCount);
    const retainedFrameCount = renderFrameCount + outputFrameCount;
    if (retainedFrameCount > MAX_OFFLINE_FRAMES) {
        throw new Error('The requested region exceeds the renderer frame limit when its timeline history is included');
    }
    return {
        renderContext,
        historySeconds,
        outputDurationSeconds,
        historyFrameCount,
        outputFrameCount,
    };
}
