import { boundStretchRatio } from '#/utils/stretchRatioBound';

/**
 * After the whole source is mirrored, `[offset, offset + consumed)` lives at
 * `[D - offset - consumed, D - offset)`. Offset is unstretched source beats;
 * `consumed` is clip length, or `clipLengthBeats * stretchRatio` when stretch
 * is on — the window the scheduler actually reads. Point `audioOffsetBeats`
 * there so a trimmed, split, slipped, or stretched clip still plays its own
 * window backwards.
 */
export function reversedClipAudioOffsetBeats(input: {
    audioOffsetBeats: number;
    clipLengthBeats: number;
    bufferLength: number;
    sampleRate: number;
    tempo: number;
    stretchMode?: string;
    stretchRatio?: number;
}): number | undefined {
    const { audioOffsetBeats, clipLengthBeats, bufferLength, sampleRate, tempo } = input;
    if (!Number.isFinite(audioOffsetBeats) || !Number.isFinite(clipLengthBeats)) {
        return undefined;
    }
    if (!Number.isFinite(bufferLength) || bufferLength <= 0) {
        return undefined;
    }
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
        return undefined;
    }
    const clipSecondsPerBeat = Number.isFinite(tempo) && tempo > 0 ? 60 / tempo : 0;
    if (clipSecondsPerBeat <= 0) {
        return undefined;
    }
    const sourceLengthBeats = bufferLength / sampleRate / clipSecondsPerBeat;
    if (!Number.isFinite(sourceLengthBeats)) {
        return undefined;
    }
    return sourceLengthBeats - audioOffsetBeats - sourceConsumedBeats(input);
}

function sourceConsumedBeats(input: { clipLengthBeats: number; stretchMode?: string; stretchRatio?: number }): number {
    if (!input.stretchMode || input.stretchMode === 'off') {
        return input.clipLengthBeats;
    }
    return input.clipLengthBeats * boundStretchRatio(input.stretchRatio ?? 1);
}
