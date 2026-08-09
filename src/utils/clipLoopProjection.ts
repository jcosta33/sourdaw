export const MIN_CLIP_LOOP_LENGTH_BEATS = 1 / 480;
export const MAX_CLIP_LOOP_ITERATIONS = 4096;

type ProjectClipLoopExpansionInput = {
    clipDurationBeats: number;
    configuredLoopLengthBeats?: number;
    loopEnabled: boolean;
};

type ProjectClipLoopExpansionOutput = {
    iterationCount: number;
    loopLengthBeats: number;
};

export function projectClipLoopExpansion({
    clipDurationBeats,
    configuredLoopLengthBeats,
    loopEnabled,
}: ProjectClipLoopExpansionInput): ProjectClipLoopExpansionOutput {
    if (!Number.isFinite(clipDurationBeats) || clipDurationBeats <= 0) {
        return { iterationCount: 0, loopLengthBeats: MIN_CLIP_LOOP_LENGTH_BEATS };
    }
    const safeClipDuration = clipDurationBeats;
    if (!loopEnabled) {
        return { iterationCount: 1, loopLengthBeats: safeClipDuration };
    }

    const hasUsableConfiguredLength =
        configuredLoopLengthBeats !== undefined &&
        Number.isFinite(configuredLoopLengthBeats) &&
        configuredLoopLengthBeats > 0;
    const requestedLoopLength = hasUsableConfiguredLength ? configuredLoopLengthBeats : safeClipDuration;
    const minimumBoundedLength = Math.max(MIN_CLIP_LOOP_LENGTH_BEATS, safeClipDuration / MAX_CLIP_LOOP_ITERATIONS);
    const loopLengthBeats = Math.max(requestedLoopLength, minimumBoundedLength);
    const iterationCount = Math.min(
        MAX_CLIP_LOOP_ITERATIONS,
        Math.max(1, Math.ceil(safeClipDuration / loopLengthBeats))
    );
    return { iterationCount, loopLengthBeats };
}
