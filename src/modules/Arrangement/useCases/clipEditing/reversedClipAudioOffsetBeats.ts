/**
 * After the whole source is mirrored, `[offset, offset + length)` lives at
 * `[D - offset - length, D - offset)`. Point `audioOffsetBeats` there so a
 * trimmed, split, or slipped clip still plays its own window backwards.
 */
export function reversedClipAudioOffsetBeats(input: {
    audioOffsetBeats: number;
    clipLengthBeats: number;
    bufferLength: number;
    sampleRate: number;
    tempo: number;
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
    return sourceLengthBeats - audioOffsetBeats - clipLengthBeats;
}
