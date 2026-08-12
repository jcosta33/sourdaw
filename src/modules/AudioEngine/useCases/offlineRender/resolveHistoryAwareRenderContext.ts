import { beatToSeconds } from '../../services/beatConversion';

import { MAX_OFFLINE_FRAMES } from './constants';
import { resolveRenderContext, type ResolveRenderContextInput } from './resolveRenderContext';

type HistoryAwareRenderContext = {
    renderContext: ReturnType<typeof resolveRenderContext>;
    historySeconds: number;
    outputDurationSeconds: number;
};

/**
 * Resolves a bounded render against timeline zero so stateful devices receive
 * the same prior events as a full playthrough. The requested window remains a
 * separate duration and is cropped only after the graph has rendered.
 */
export function resolveHistoryAwareRenderContext(input: ResolveRenderContextInput): HistoryAwareRenderContext {
    const startBeat = input.startBeat ?? 0;
    if (startBeat <= 0) {
        const renderContext = resolveRenderContext(input);
        return {
            renderContext,
            historySeconds: 0,
            outputDurationSeconds: renderContext.durationSeconds,
        };
    }

    const renderContext = resolveRenderContext({
        ...input,
        durationBeats: startBeat + input.durationBeats,
        startBeat: 0,
    });
    const sampleRate = input.sampleRate ?? 44_100;
    if (Math.ceil(renderContext.durationSeconds * sampleRate) > MAX_OFFLINE_FRAMES) {
        throw new Error('The requested region exceeds the renderer frame limit when its timeline history is included');
    }
    const historyProjection = renderContext.projectPpqEndpoints?.({
        startPpq: 0,
        endPpq: startBeat,
        defaultTempo: renderContext.defaultTempo,
        sampleRate,
        changes: renderContext.changes,
    });
    const legacyHistorySeconds =
        beatToSeconds(startBeat, renderContext.defaultTempo, renderContext.changes) -
        beatToSeconds(0, renderContext.defaultTempo, renderContext.changes);
    const historySeconds = Math.max(0, historyProjection?.durationSeconds ?? legacyHistorySeconds);
    return {
        renderContext,
        historySeconds,
        outputDurationSeconds: Math.max(0, renderContext.durationSeconds - historySeconds),
    };
}
