import { MAX_OFFLINE_FRAMES } from './constants';

type ClampRenderFrameCountInput = {
    durationSeconds: number;
    sampleRate: number;
    /** Notified when the requested timeline does not fit in a single render. */
    onWarning?: (message: string) => void;
};

/**
 * Resolves the frame count for an offline render, capped to what the renderer
 * can allocate.
 *
 * The cap itself is unavoidable, but it used to be applied silently, so
 * an over-long export produced a short file that looked like a success. Both the
 * mixdown and the stem path resolve their frame count here so the truncation is
 * always reported the same way.
 */
export function clampRenderFrameCount({ durationSeconds, sampleRate, onWarning }: ClampRenderFrameCountInput): number {
    const requestedFrames = Math.ceil(durationSeconds * sampleRate);
    const frameCount = Math.min(requestedFrames, MAX_OFFLINE_FRAMES);

    if (frameCount < requestedFrames) {
        const renderedHours = frameCount / sampleRate / 3600;
        const requestedHours = requestedFrames / sampleRate / 3600;
        onWarning?.(
            `Export truncated to ${renderedHours.toFixed(2)} h: this renderer caps a single render at ` +
                `${MAX_OFFLINE_FRAMES} frames, and ${requestedHours.toFixed(2)} h was requested. ` +
                `Export in shorter sections to capture the whole timeline.`
        );
    }

    return frameCount;
}
